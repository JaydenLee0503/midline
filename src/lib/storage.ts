/**
 * Session history and settings, kept in localStorage. Nothing leaves the
 * browser: no video, no images, no landmarks - only the scores you see on the
 * results screen.
 *
 * Every read is defensive. A corrupted or older entry is dropped rather than
 * allowed to break the History screen.
 */
import { DEFAULT_OBJECT, type ObjectId } from './objects';
import { DEFAULT_SIDE_CONFIG, type SessionRecord, type SideConfig } from './types';

const SESSIONS_KEY = 'midline.sessions.v1';
const SETTINGS_KEY = 'midline.settings.v1';
const GAME_KEY = 'midline.game.v1';

export const SCHEMA_VERSION = 1;
/** Plenty for years of daily practice, and keeps localStorage small. */
export const MAX_SESSIONS = 500;

export interface Settings {
  sideConfig: SideConfig;
  showDebug: boolean;
  /** Game: register slower punches, for players who cannot move quickly. */
  gameGentle: boolean;
  gameMuted: boolean;
  /** Game: which object to punch. */
  gameObject: ObjectId;
}

export const DEFAULT_SETTINGS: Settings = {
  sideConfig: DEFAULT_SIDE_CONFIG,
  showDebug: false,
  gameGentle: false,
  gameMuted: false,
  gameObject: DEFAULT_OBJECT,
};

/** One finished round of the punching game. */
export interface GameRecord {
  at: string;
  score: number;
  bestCombo: number;
  punches: number;
  hits: number;
  destroyed: number;
  missed: number;
}

export const MAX_GAME_RECORDS = 50;

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`[midline] cannot read ${key} from localStorage`, error);
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[midline] cannot write ${key} to localStorage`, error);
    return false;
  }
}

const OBJECT_IDS: readonly string[] = ['ball', 'bag', 'chair', 'crate', 'pillow'];

function isObjectId(value: unknown): value is ObjectId {
  return typeof value === 'string' && OBJECT_IDS.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function looksLikeSession(value: unknown): value is SessionRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.startedAt === 'string' &&
    Array.isArray(value.exercises) &&
    (value.overallScore === null || typeof value.overallScore === 'number')
  );
}

export function loadSessions(): SessionRecord[] {
  const raw = readRaw(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(looksLikeSession)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  } catch (error) {
    console.warn('[midline] session history could not be parsed; starting fresh', error);
    return [];
  }
}

function persistSessions(sessions: SessionRecord[]): boolean {
  const trimmed = sessions.slice(-MAX_SESSIONS);
  return writeRaw(SESSIONS_KEY, JSON.stringify(trimmed));
}

/** Appends a session and returns the new history (oldest first). */
export function saveSession(record: SessionRecord): SessionRecord[] {
  const sessions = [...loadSessions(), record].slice(-MAX_SESSIONS);
  persistSessions(sessions);
  return sessions;
}

/** Removes one session, e.g. one where calibration clearly went wrong. */
export function deleteSession(id: string): SessionRecord[] {
  const sessions = loadSessions().filter((session) => session.id !== id);
  persistSessions(sessions);
  return sessions;
}

export function clearSessions(): void {
  try {
    window.localStorage.removeItem(SESSIONS_KEY);
  } catch (error) {
    console.warn('[midline] could not clear history', error);
  }
}

export function loadSettings(): Settings {
  const raw = readRaw(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;
    const side = isRecord(parsed.sideConfig) ? parsed.sideConfig : {};
    return {
      showDebug: parsed.showDebug === true,
      gameGentle: parsed.gameGentle === true,
      gameMuted: parsed.gameMuted === true,
      gameObject: isObjectId(parsed.gameObject) ? parsed.gameObject : DEFAULT_OBJECT,
      sideConfig: {
        swapBlendshapes: side.swapBlendshapes === true,
        swapLandmarks: side.swapLandmarks === true,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  writeRaw(SETTINGS_KEY, JSON.stringify(settings));
}

function looksLikeGameRecord(value: unknown): value is GameRecord {
  return isRecord(value) && typeof value.at === 'string' && typeof value.score === 'number';
}

export function loadGameScores(): GameRecord[] {
  const raw = readRaw(GAME_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(looksLikeGameRecord);
  } catch {
    return [];
  }
}

export function saveGameScore(record: GameRecord): GameRecord[] {
  const scores = [...loadGameScores(), record].slice(-MAX_GAME_RECORDS);
  writeRaw(GAME_KEY, JSON.stringify(scores));
  return scores;
}

export function bestGameScore(scores: readonly GameRecord[] = loadGameScores()): number {
  return scores.reduce((best, record) => Math.max(best, record.score), 0);
}

export function clearGameScores(): void {
  try {
    window.localStorage.removeItem(GAME_KEY);
  } catch (error) {
    console.warn('[midline] could not clear game scores', error);
  }
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
