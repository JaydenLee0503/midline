/**
 * The game's animation loop. Physics and drawing run every animation frame for
 * smooth motion; the models only run when the camera has actually produced a
 * new image.
 *
 * The hand model runs on every analysed frame because fists move fast and that
 * is where precision matters. The pose model runs on every third, because the
 * body frame it provides - shoulder width for scale, the elbow for telling an
 * uppercut from a hook - barely changes in 60ms and running both flat out costs
 * more than it buys.
 */
import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState } from 'react';
import { COUNTDOWN_MS, type GameController, type TrackingFrame } from '../lib/gameController';
import { drawCountdown, drawGame } from '../lib/gameRender';
import { readHand, type HandReading, type PoseSample } from '../lib/punch';

/** Run the pose model on one frame in this many. */
const POSE_EVERY = 3;

export interface GameLoopOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  pose: PoseLandmarker | null;
  hands: HandLandmarker | null;
  controller: GameController;
  active: boolean;
}

export function useGameLoop({
  videoRef,
  canvasRef,
  pose,
  hands,
  controller,
  active,
}: GameLoopOptions): { error: Error | null } {
  const [error, setError] = useState<Error | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!active || !pose) return;

    let stopped = false;
    let lastVideoTime = -1;
    let analysed = 0;
    let countdownStart = 0;
    let lastCountdown = -1;

    const tick = (): void => {
      if (stopped) return;
      frameRef.current = requestAnimationFrame(tick);

      const now = performance.now();
      const video = videoRef.current;
      let frame: TrackingFrame | null = null;

      if (video && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const aspect = video.videoWidth / video.videoHeight;

        try {
          let poseSample: PoseSample | null = null;
          if (analysed % POSE_EVERY === 0) {
            const result = pose.detectForVideo(video, now);
            const landmarks = result.landmarks[0];
            if (landmarks && landmarks.length > 0) {
              poseSample = {
                t: now,
                landmarks,
                world: result.worldLandmarks[0] ?? null,
                aspect,
              };
            }
          }

          const readings: HandReading[] = [];
          if (hands) {
            const result = hands.detectForVideo(video, now);
            for (const landmarks of result.landmarks) {
              const reading = readHand(landmarks, aspect);
              if (reading) readings.push(reading);
            }
          }

          analysed += 1;
          frame = { pose: poseSample, hands: readings };
        } catch (cause) {
          stopped = true;
          cancelAnimationFrame(frameRef.current);
          setError(cause instanceof Error ? cause : new Error(String(cause)));
          return;
        }
      }

      controller.update(now, frame);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const state = controller.getRenderState();
      drawGame(ctx, width, height, state);

      if (state.stage === 'countdown') {
        const value = controller.store.getSnapshot().countdown;
        if (value !== lastCountdown) {
          lastCountdown = value;
          countdownStart = now;
        }
        const step = value <= 0 ? COUNTDOWN_MS - 3000 : 1000;
        drawCountdown(ctx, width, height, value, Math.min(1, (now - countdownStart) / Math.max(120, step)));
      } else {
        lastCountdown = -1;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frameRef.current);
    };
  }, [active, pose, hands, controller, videoRef, canvasRef]);

  return { error };
}
