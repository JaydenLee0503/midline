import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './components/AppShell';
import HomeScreen from './components/HomeScreen';
import ResultsScreen from './components/ResultsScreen';
import SessionFlow from './components/SessionFlow';
import {
  bestGameScore,
  clearGameScores,
  clearSessions,
  deleteSession,
  loadGameScores,
  loadSessions,
  loadSettings,
  saveGameScore,
  saveSession,
  saveSettings,
  type GameRecord,
  type Settings,
} from './lib/storage';
import type { SessionRecord } from './lib/types';

// The history screen is the only thing that pulls in the charting library, so
// it is split out of the first load.
const HistoryScreen = lazy(() => import('./components/HistoryScreen'));
// The game pulls in the pose model wrapper and its own engine; nobody who does
// not open it should pay for that.
const GameScreen = lazy(() => import('./components/GameScreen'));

function ScreenFallback({ label }: { label: string }) {
  return (
    <p className="screen text-xl" role="status">
      {label}
    </p>
  );
}

type Route = 'home' | 'session' | 'results' | 'history' | 'game';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [lastRecord, setLastRecord] = useState<SessionRecord | null>(null);
  const [gameScores, setGameScores] = useState<GameRecord[]>(() => loadGameScores());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  /** The session before the one just finished, for the "last time" comparison. */
  const previous = useMemo(() => {
    if (!lastRecord) return null;
    const earlier = sessions.filter((session) => session.id !== lastRecord.id);
    return earlier[earlier.length - 1] ?? null;
  }, [sessions, lastRecord]);

  const handleGameFinished = useCallback((record: GameRecord) => {
    setGameScores(saveGameScore(record));
  }, []);

  const handleComplete = useCallback((record: SessionRecord) => {
    setLastRecord(record);
    setSessions(saveSession(record));
    setRoute('results');
  }, []);

  return (
    <AppShell
      onHome={() => setRoute('home')}
      onHistory={() => setRoute('history')}
      onGame={() => setRoute('game')}
      showNav={route !== 'session' && route !== 'game'}
      variant={route === 'home' ? 'landing' : 'default'}
    >
      {route === 'home' && (
        <HomeScreen
          sessions={sessions}
          onStart={() => setRoute('session')}
          onHistory={() => setRoute('history')}
          onGame={() => setRoute('game')}
        />
      )}

      {route === 'session' && (
        <SessionFlow
          settings={settings}
          onSettingsChange={setSettings}
          onComplete={handleComplete}
          onExit={() => setRoute('home')}
        />
      )}

      {route === 'results' && lastRecord && (
        <ResultsScreen
          record={lastRecord}
          previous={previous}
          onDone={() => setRoute('home')}
          onHistory={() => setRoute('history')}
        />
      )}

      {route === 'game' && (
        <Suspense fallback={<ScreenFallback label="Loading the game..." />}>
          <GameScreen
            settings={settings}
            onSettingsChange={setSettings}
            best={bestGameScore(gameScores)}
            onFinished={handleGameFinished}
            onExit={() => setRoute('home')}
          />
        </Suspense>
      )}

      {route === 'history' && (
        <Suspense fallback={<ScreenFallback label="Loading your progress..." />}>
          <HistoryScreen
            sessions={sessions}
            onBack={() => setRoute('home')}
            onStart={() => setRoute('session')}
            onClearAll={() => {
              clearSessions();
              clearGameScores();
              setSessions([]);
              setGameScores([]);
              setLastRecord(null);
            }}
            onDeleteSession={(id) => {
              setSessions(deleteSession(id));
              setLastRecord((current) => (current?.id === id ? null : current));
            }}
          />
        </Suspense>
      )}
    </AppShell>
  );
}
