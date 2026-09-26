/**
 * The mirrored camera view with the landmark + midline overlay on top.
 *
 * The container's aspect ratio follows the actual camera aspect ratio so the
 * canvas lines up with the video exactly, with no cropping or letterboxing.
 * Video and canvas are mirrored together, which is why the overlay draws no
 * text - the side labels below are plain HTML.
 */
import { useState } from 'react';
import type { PoseProblem } from '../lib/metrics';

export function alignmentHint(problem: PoseProblem | null): string | null {
  switch (problem) {
    case 'turned':
      return 'Turn to face the camera';
    case 'nodding':
      return 'Look straight ahead';
    case 'tilted':
      return 'Level your head';
    case null:
      return null;
  }
}

export interface VideoStageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  faceDetected: boolean;
  alignment: PoseProblem | null;
  /** Shown instead of the automatic hints, e.g. while the camera is starting. */
  overrideMessage?: string | null;
  showSideLabels?: boolean;
}

export default function VideoStage({
  videoRef,
  canvasRef,
  faceDetected,
  alignment,
  overrideMessage = null,
  showSideLabels = true,
}: VideoStageProps) {
  const [aspect, setAspect] = useState(16 / 9);

  const message =
    overrideMessage ?? (!faceDetected ? 'Looking for your face' : alignmentHint(alignment));

  return (
    <div className="mx-auto w-full">
      <div
        className="relative w-full overflow-hidden border-2 border-line bg-ink/90"
        style={{ aspectRatio: aspect }}
      >
        <div className="absolute inset-0 -scale-x-100">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setAspect(video.videoWidth / video.videoHeight);
              }
            }}
          />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        {showSideLabels && (
          <>
            <span className="absolute top-3 left-3 bg-side-left px-3 py-1 text-base font-semibold text-white">
              Your left
            </span>
            <span className="absolute top-3 right-3 bg-side-right px-3 py-1 text-base font-semibold text-white">
              Your right
            </span>
          </>
        )}

        {message && (
          <p
            className="absolute inset-x-0 bottom-0 bg-ink/80 px-4 py-3 text-center text-xl font-semibold text-white"
            role="status"
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
