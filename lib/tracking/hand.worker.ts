/// <reference lib="webworker" />
// Runs MediaPipe Hand Landmarker off the main thread so inference never blocks
// rendering, pointer input or audio scheduling.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

declare const self: DedicatedWorkerGlobalScope;

type InMsg =
  | { type: 'init'; wasm: string; models: string[] }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number };

let landmarker: HandLandmarker | null = null;

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      // Bundlers may emit this as a classic or a module worker; pick the matching WASM loader.
      let classic = true;
      try {
        self.importScripts();
      } catch {
        classic = false;
      }
      const fileset = await FilesetResolver.forVisionTasks(msg.wasm, !classic);
      let lastError: unknown;
      for (const delegate of ['GPU', 'CPU'] as const) {
        for (const modelAssetPath of msg.models) {
          try {
            landmarker = await HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.6,
              minHandPresenceConfidence: 0.6,
              minTrackingConfidence: 0.5,
            });
            self.postMessage({ type: 'ready', delegate });
            return;
          } catch (err) {
            lastError = err;
          }
        }
      }
      throw lastError;
    } catch (err) {
      self.postMessage({ type: 'error', message: (err as Error)?.message || String(err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    const { bitmap, ts } = msg;
    if (!landmarker) {
      bitmap.close();
      self.postMessage({ type: 'result', ts, landmarks: [], handedness: [] });
      return;
    }
    try {
      const t0 = performance.now();
      const res = landmarker.detectForVideo(bitmap, ts);
      self.postMessage({
        type: 'result',
        ts,
        ms: performance.now() - t0,
        landmarks: res.landmarks.map(h => h.map(p => ({ x: p.x, y: p.y }))),
        handedness: res.handedness.map(h => h.map(c => ({ categoryName: c.categoryName, score: c.score }))),
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: (err as Error)?.message || String(err) });
    } finally {
      bitmap.close();
    }
  }
};
