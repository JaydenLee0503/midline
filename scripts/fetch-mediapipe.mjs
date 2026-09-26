#!/usr/bin/env node
/**
 * Puts everything MediaPipe needs into /public so the running app makes no
 * third-party network requests:
 *
 *   public/models/face_landmarker.task   <- downloaded from Google's model store
 *   public/mediapipe/wasm/*              <- copied out of node_modules
 *
 * Idempotent: already-present files are left alone. Pass --force to redo.
 * Never fails the install - it warns instead, and the app shows a clear
 * "run npm run setup" message if the model is missing.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat, readdir, copyFile, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const MODELS = [
  {
    label: 'face landmark model',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    dest: join(root, 'public', 'models', 'face_landmarker.task'),
    size: '3.8 MB',
  },
  {
    // Used by the punching game to track both arms.
    label: 'pose model',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    dest: join(root, 'public', 'models', 'pose_landmarker_lite.task'),
    size: '5.8 MB',
  },
  {
    // Gives the game all 21 joints per hand, for a precise strike point.
    label: 'hand model',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    dest: join(root, 'public', 'models', 'hand_landmarker.task'),
    size: '7.8 MB',
  },
];
const WASM_SRC = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DEST = join(root, 'public', 'mediapipe', 'wasm');

const MIN_MODEL_BYTES = 1_000_000;

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

function download(url, dest, redirects = 0) {
  return new Promise((resolvePromise, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const req = get(url, { timeout: 60_000 }, async (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolvePromise, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      try {
        await pipeline(res, createWriteStream(`${dest}.part`));
        resolvePromise();
      } catch (err) {
        reject(err);
      }
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
  });
}

async function fetchModel(model) {
  const name = model.dest.split(/[\\/]/).pop();
  const existing = await sizeOf(model.dest);
  if (!force && existing >= MIN_MODEL_BYTES) {
    console.log(`[midline] ${name} already present (${(existing / 1e6).toFixed(1)} MB)`);
    return;
  }
  await mkdir(dirname(model.dest), { recursive: true });
  console.log(`[midline] downloading ${name} (~${model.size}) ...`);
  await download(model.url, model.dest);
  const got = await sizeOf(`${model.dest}.part`);
  if (got < MIN_MODEL_BYTES) {
    await rm(`${model.dest}.part`, { force: true });
    throw new Error(`downloaded file looks wrong (${got} bytes)`);
  }
  await copyFile(`${model.dest}.part`, model.dest);
  await rm(`${model.dest}.part`, { force: true });
  console.log(`[midline] saved public/models/${name} (${(got / 1e6).toFixed(1)} MB)`);
}

async function copyWasm() {
  let entries;
  try {
    entries = await readdir(WASM_SRC);
  } catch {
    console.warn('[midline] @mediapipe/tasks-vision is not installed yet - skipping wasm copy.');
    return false;
  }
  await mkdir(WASM_DEST, { recursive: true });
  let copied = 0;
  for (const name of entries) {
    const from = join(WASM_SRC, name);
    const to = join(WASM_DEST, name);
    if ((await stat(from)).isDirectory()) continue;
    if (!force && (await sizeOf(to)) === (await sizeOf(from))) continue;
    await copyFile(from, to);
    copied += 1;
  }
  console.log(
    copied > 0
      ? `[midline] copied ${copied} MediaPipe wasm file(s) to public/mediapipe/wasm/`
      : '[midline] MediaPipe wasm files already up to date'
  );
  return true;
}

let failed = false;
try {
  if (!(await copyWasm())) failed = true;
} catch (err) {
  failed = true;
  console.warn(`[midline] could not copy wasm files: ${err.message}`);
}
for (const model of MODELS) {
  try {
    await fetchModel(model);
  } catch (err) {
    failed = true;
    console.warn(`\n[midline] !! could not download the ${model.label}: ${err.message}`);
    console.warn('[midline] !! run "npm run setup" once you have network access, or download');
    console.warn(`[midline] !! ${model.url}`);
    console.warn(`[midline] !! manually to ${model.dest}\n`);
  }
}
if (!failed) console.log('[midline] setup complete - offline assets are in place.');
