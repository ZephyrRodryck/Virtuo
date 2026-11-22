// Copies the MediaPipe WASM runtime into /public and fetches the hand model once,
// so hand tracking is served from this app instead of a third-party CDN.
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

await mkdir(outDir, { recursive: true });
await cp(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(outDir, 'wasm'), { recursive: true });
console.log('[mediapipe] wasm runtime copied');

const modelPath = join(outDir, 'hand_landmarker.task');
const exists = await stat(modelPath).then(s => s.size > 1_000_000).catch(() => false);
if (!exists) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('[mediapipe] hand model downloaded');
  } catch (err) {
    // Non-fatal: the tracker falls back to loading the model from MODEL_URL at runtime.
    console.warn('[mediapipe] model download failed, runtime will use the remote URL:', err.message);
  }
}
