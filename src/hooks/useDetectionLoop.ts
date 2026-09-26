/**
 * The requestAnimationFrame detection loop.
 *
 * Nothing in here sets React state: each frame goes to the SessionController
 * (which publishes a throttled snapshot) and to the canvas overlay. That keeps
 * rendering at ~10 Hz while detection runs at video rate.
 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState } from 'react';
import { focusPoints } from '../lib/exercises';
import { headPoseFromMatrix } from '../lib/metrics';
import { clearOverlay, drawOverlay } from '../lib/overlay';
import type { SessionController } from '../lib/sessionController';
import type { FaceSample, Landmark } from '../lib/types';

export interface DetectionLoopOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  landmarker: FaceLandmarker | null;
  controller: SessionController;
  /** Set false to stop detecting (screens that do not need the camera). */
  active: boolean;
}

export interface DetectionLoopState {
  /** A detection error, e.g. the WASM backend failing mid-session. */
  error: Error | null;
}

export function useDetectionLoop(options: DetectionLoopOptions): DetectionLoopState {
  const { videoRef, canvasRef, landmarker, controller, active } = options;
  const [error, setError] = useState<Error | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!active || !landmarker) return;

    let lastVideoTime = -1;
    let stopped = false;

    const tick = (): void => {
      if (stopped) return;
      frameRef.current = requestAnimationFrame(tick);

      const video = videoRef.current;
      const now = performance.now();

      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        controller.pushFrame(now, null);
        return;
      }

      // detectForVideo must see each frame once, with increasing timestamps.
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      let landmarks: Landmark[] | null = null;
      let sample: FaceSample | null = null;

      try {
        const result = landmarker.detectForVideo(video, now);
        const found = result.faceLandmarks[0];
        if (found && found.length > 0) {
          landmarks = found;
          const blendshapes: Record<string, number> = {};
          for (const category of result.faceBlendshapes[0]?.categories ?? []) {
            blendshapes[category.categoryName] = category.score;
          }
          sample = {
            t: now,
            landmarks: found,
            blendshapes,
            headPose: headPoseFromMatrix(result.facialTransformationMatrixes[0]?.data),
            aspect: video.videoWidth / video.videoHeight,
          };
        }
      } catch (cause) {
        stopped = true;
        cancelAnimationFrame(frameRef.current);
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        return;
      }

      controller.pushFrame(now, sample);

      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const exercise = controller.store.getSnapshot().exercise;
          drawOverlay(ctx, canvas.width, canvas.height, {
            landmarks,
            geometry: controller.getLastGeometry(),
            usable: controller.isUsable(),
            highlight: exercise ? focusPoints(exercise) : [],
          });
        }
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(frameRef.current);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) clearOverlay(ctx, canvas.width, canvas.height);
    };
  }, [active, landmarker, controller, videoRef, canvasRef]);

  return { error };
}
