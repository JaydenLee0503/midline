/**
 * Owns the camera, the landmarker and the session controller for one practice
 * session, and shows whichever step the session is on. The video element stays
 * mounted the whole time so the camera is never restarted between steps.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCamera } from '../hooks/useCamera';
import { useDetectionLoop } from '../hooks/useDetectionLoop';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { SessionController } from '../lib/sessionController';
import type { Settings } from '../lib/storage';
import type { SessionRecord } from '../lib/types';
import CalibrationScreen from './CalibrationScreen';
import CameraSetupScreen from './CameraSetupScreen';
import DebugPanel from './DebugPanel';
import ExerciseScreen from './ExerciseScreen';
import VideoStage from './VideoStage';

export interface SessionFlowProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onComplete: (record: SessionRecord) => void;
  onExit: () => void;
}

export default function SessionFlow({
  settings,
  onSettingsChange,
  onComplete,
  onExit,
}: SessionFlowProps) {
  const [controller] = useState(() => new SessionController());
  const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handedOff = useRef(false);

  const {
    landmarker,
    status: modelStatus,
    error: modelError,
    retry: retryModel,
  } = useFaceLandmarker();
  const { videoRef, status: cameraStatus, problem: cameraProblem, retry: retryCamera } = useCamera(true);
  const { error: detectionError } = useDetectionLoop({
    videoRef,
    canvasRef,
    landmarker,
    controller,
    active: true,
  });

  useEffect(() => {
    controller.setSideConfig(settings.sideConfig);
  }, [controller, settings.sideConfig]);

  useEffect(() => {
    controller.setDebugEnabled(settings.showDebug);
  }, [controller, settings.showDebug]);

  useEffect(() => {
    if (snapshot.stage !== 'finished' || handedOff.current) return;
    const record = controller.getRecord();
    if (!record) return;
    handedOff.current = true;
    onComplete(record);
  }, [snapshot.stage, controller, onComplete]);

  const starting =
    cameraStatus !== 'ready'
      ? cameraProblem
        ? 'Camera unavailable'
        : 'Starting the camera'
      : modelStatus === 'loading'
        ? 'Loading face measurement'
        : null;

  return (
    <div className="screen">
      <VideoStage
        videoRef={videoRef}
        canvasRef={canvasRef}
        faceDetected={snapshot.faceDetected}
        alignment={snapshot.alignment}
        overrideMessage={starting}
      />

      {snapshot.stage === 'idle' && (
        <CameraSetupScreen
          cameraStatus={cameraStatus}
          cameraProblem={cameraProblem}
          onRetryCamera={retryCamera}
          modelStatus={modelStatus}
          modelError={modelError}
          onRetryModel={retryModel}
          detectionError={detectionError}
          faceDetected={snapshot.faceDetected}
          alignment={snapshot.alignment}
          onBegin={() => controller.beginCalibration()}
          onCancel={onExit}
        />
      )}

      {(snapshot.stage === 'calibrating' || snapshot.stage === 'calibrated') && (
        <CalibrationScreen
          progress={snapshot.calibrationProgress}
          ready={snapshot.stage === 'calibrated'}
          note={snapshot.calibrationNote}
          faceDetected={snapshot.faceDetected}
          onContinue={() => controller.startExercises()}
          onRedo={() => controller.beginCalibration()}
          onCancel={onExit}
        />
      )}

      {snapshot.stage === 'exercising' && (
        <ExerciseScreen
          snapshot={snapshot}
          onTogglePause={() => controller.setPaused(!snapshot.paused)}
          onSkip={() => controller.skipCurrentExercise()}
          onFinish={() => controller.finishEarly()}
        />
      )}

      {snapshot.stage === 'finished' && (
        <p className="mt-6 text-xl" role="status">
          Well done - putting your results together.
        </p>
      )}

      {settings.showDebug ? (
        <DebugPanel
          debug={snapshot.debug}
          fps={snapshot.fps}
          sideConfig={settings.sideConfig}
          onSideConfigChange={(sideConfig) => onSettingsChange({ ...settings, sideConfig })}
          onClose={() => onSettingsChange({ ...settings, showDebug: false })}
        />
      ) : (
        <button
          type="button"
          className="btn-quiet mt-8"
          onClick={() => onSettingsChange({ ...settings, showDebug: true })}
        >
          Show debug values
        </button>
      )}
    </div>
  );
}
