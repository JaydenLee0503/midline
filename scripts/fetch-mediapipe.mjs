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

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_DEST = join(root, 'public', 'models', 'face_landmarker.task');
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

async function fetchModel() {
  const existing = await sizeOf(MODEL_DEST);
  if (!force && existing >= MIN_MODEL_BYTES) {
    console.log(`[midline] model already present (${(existing / 1e6).toFixed(1)} MB)`);
    return true;
  }
  await mkdir(dirname(MODEL_DEST), { recursive: true });
  console.log('[midline] downloading face_landmarker.task (~3.8 MB) ...');
  await download(MODEL_URL, MODEL_DEST);
  const got = await sizeOf(`${MODEL_DEST}.part`);
  if (got < MIN_MODEL_BYTES) {
    await rm(`${MODEL_DEST}.part`, { force: true });
    throw new Error(`downloaded file looks wrong (${got} bytes)`);
  }
  await copyFile(`${MODEL_DEST}.part`, MODEL_DEST);
  await rm(`${MODEL_DEST}.part`, { force: true });
  console.log(`[midline] saved public/models/face_landmarker.task (${(got / 1e6).toFixed(1)} MB)`);
  return true;
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
try {
  await fetchModel();
} catch (err) {
  failed = true;
  console.warn(`\n[midline] !! could not download the face landmark model: ${err.message}`);
  console.warn('[midline] !! run "npm run setup" once you have network access, or download');
  console.warn(`[midline] !! ${MODEL_URL}`);
  console.warn('[midline] !! manually to public/models/face_landmarker.task\n');
}
if (!failed) console.log('[midline] setup complete - offline assets are in place.');
