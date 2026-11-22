import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { OneEuro } from './oneEuro';

export type CameraStatus = 'idle' | 'requesting' | 'loading' | 'running' | 'denied' | 'unavailable' | 'error';

export interface TrackedHand {
  id: 'Left' | 'Right';
  /** 21 landmarks, normalised to the video frame and mirrored (selfie view). */
  points: { x: number; y: number }[];
  score: number;
}

type RawHands = {
  landmarks: { x: number; y: number }[][];
  handedness: { categoryName: string; score: number }[][];
};

const WASM_PATH = '/mediapipe/wasm';
const LOCAL_MODEL = '/mediapipe/hand_landmarker.task';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let mainThreadLandmarker: Promise<HandLandmarker> | null = null;

/** Fallback when module workers / OffscreenCanvas are unavailable: inference on the main thread. */
function loadMainThreadLandmarker(): Promise<HandLandmarker> {
  mainThreadLandmarker ??= (async () => {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    let lastError: unknown;
    for (const delegate of ['GPU', 'CPU'] as const) {
      for (const modelAssetPath of [LOCAL_MODEL, REMOTE_MODEL]) {
        try {
          return await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.5,
          });
        } catch (err) {
          lastError = err;
        }
      }
    }
    throw lastError;
  })().catch(err => {
    mainThreadLandmarker = null;
    throw err;
  });
  return mainThreadLandmarker;
}

type Listener = () => void;

/**
 * Webcam + MediaPipe Hand Landmarker. Inference runs in a Web Worker (frames are sent as
 * transferable ImageBitmaps, at most one in flight); landmarks are smoothed per point with
 * a One Euro filter.
 */
export class HandTracker {
  status: CameraStatus = 'idle';
  error = '';
  hands: TrackedHand[] = [];
  frameSeq = 0;
  frameTime = 0;
  fps = 0;
  inferenceMs = 0;
  backend = '';
  videoWidth = 1280;
  videoHeight = 720;

  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private workerReady: Promise<boolean> | null = null;
  private landmarker: HandLandmarker | null = null;
  private busy = false;
  private rafId = 0;
  private vfcId = 0;
  private lastVideoTime = -1;
  private filters = new Map<string, OneEuro[]>();
  private lastSeen = new Map<string, number>();
  private listeners = new Set<Listener>();
  private disposed = false;

  constructor(readonly video: HTMLVideoElement) {}

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(status: CameraStatus, error = '') {
    this.status = status;
    this.error = error;
    this.listeners.forEach(fn => fn());
  }

  async start(deviceId?: string) {
    if (this.status === 'requesting' || this.status === 'loading' || this.status === 'running') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.set('unavailable', 'This browser does not expose a camera API (a secure https:// or localhost origin is required).');
      return;
    }
    this.set('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') this.set('denied', 'Camera permission was denied.');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') this.set('unavailable', 'No camera was found.');
      else if (name === 'NotReadableError') this.set('error', 'The camera is in use by another application.');
      else this.set('error', (err as Error)?.message || 'Could not start the camera.');
      return;
    }
    if (this.disposed) return this.releaseStream();

    try {
      this.video.srcObject = this.stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      this.videoWidth = this.video.videoWidth || 960;
      this.videoHeight = this.video.videoHeight || 540;
      this.set('loading');
      if (!(await this.initWorker())) {
        this.landmarker = await loadMainThreadLandmarker();
        this.backend = 'main thread';
      }
    } catch (err) {
      this.releaseStream();
      this.set('error', `Hand tracking failed to load: ${(err as Error)?.message || err}`);
      return;
    }
    if (this.disposed || !this.stream) return this.releaseStream();
    this.set('running');
    this.schedule();
  }

  private initWorker(): Promise<boolean> {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      return Promise.resolve(false);
    }
    this.workerReady ??= new Promise<boolean>(resolve => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' });
      } catch {
        return resolve(false);
      }
      const timeout = setTimeout(() => done(false), 30000);
      const done = (ok: boolean) => {
        clearTimeout(timeout);
        if (!ok) {
          worker.terminate();
          this.worker = null;
        }
        resolve(ok);
      };
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'ready') {
          this.backend = `worker · ${m.delegate}`;
          this.worker = worker;
          worker.onmessage = ev => this.onWorkerMessage(ev.data);
          done(true);
        } else if (m.type === 'error') {
          console.warn('[hand-tracker] worker init failed, using main thread:', m.message);
          done(false);
        }
      };
      worker.onerror = e => {
        console.warn('[hand-tracker] worker failed to load, using main thread:', e.message);
        done(false);
      };
      const origin = location.origin;
      worker.postMessage({ type: 'init', wasm: origin + WASM_PATH, models: [origin + LOCAL_MODEL, REMOTE_MODEL] });
    }).then(ok => {
      if (!ok) this.workerReady = null;
      return ok;
    });
    return this.workerReady;
  }

  private onWorkerMessage(m: { type: string; ts: number; ms?: number; message?: string } & RawHands) {
    this.busy = false;
    if (m.type === 'error') {
      this.set('error', `Hand tracking stopped: ${m.message}`);
      return;
    }
    if (m.type !== 'result' || this.status !== 'running') return;
    if (m.ms) this.inferenceMs += (m.ms - this.inferenceMs) * 0.2;
    this.ingest(m.landmarks, m.handedness, m.ts);
  }

  private schedule() {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) this.vfcId = v.requestVideoFrameCallback(() => this.onVideoFrame());
    else this.rafId = requestAnimationFrame(() => this.onVideoFrame());
  }

  private onVideoFrame() {
    if (this.status !== 'running') return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      if (this.worker) {
        if (!this.busy) {
          this.busy = true;
          this.lastVideoTime = v.currentTime;
          const ts = performance.now();
          // The palm/landmark models run at ~192–224 px, so a small frame loses no accuracy
          // but makes upload and preprocessing in the worker far cheaper.
          const w = Math.min(v.videoWidth, 480);
          createImageBitmap(v, { resizeWidth: w, resizeHeight: Math.round((w * v.videoHeight) / v.videoWidth), resizeQuality: 'low' })
            .then(bitmap => this.worker?.postMessage({ type: 'frame', bitmap, ts }, [bitmap]))
            .catch(() => {
              this.busy = false;
            });
        }
      } else if (this.landmarker) {
        this.lastVideoTime = v.currentTime;
        const now = performance.now();
        try {
          const res = this.landmarker.detectForVideo(v, now);
          this.inferenceMs += (performance.now() - now - this.inferenceMs) * 0.2;
          this.ingest(res.landmarks, res.handedness, now);
        } catch (err) {
          this.set('error', `Hand tracking stopped: ${(err as Error)?.message || err}`);
          return;
        }
      }
    }
    this.schedule();
  }

  private ingest(landmarks: RawHands['landmarks'], handedness: RawHands['handedness'], now: number) {
    if (this.frameTime) this.fps += (1000 / Math.max(1, now - this.frameTime) - this.fps) * 0.2;
    this.frameTime = now;
    const used = new Set<string>();
    const hands: TrackedHand[] = [];
    landmarks.forEach((pts, i) => {
      let id: TrackedHand['id'] = handedness[i]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
      if (used.has(id)) id = id === 'Left' ? 'Right' : 'Left';
      used.add(id);
      // Reset smoothing when a hand reappears so it does not glide in from its old position.
      if (now - (this.lastSeen.get(id) ?? -Infinity) > 300) this.filters.delete(id);
      this.lastSeen.set(id, now);
      let f = this.filters.get(id);
      if (!f) {
        f = Array.from({ length: 42 }, () => new OneEuro(1.5, 0.03));
        this.filters.set(id, f);
      }
      const filters = f;
      const points = pts.map((p, j) => ({
        x: filters[j * 2].filter(1 - p.x, now),
        y: filters[j * 2 + 1].filter(p.y, now),
      }));
      hands.push({ id, points, score: handedness[i]?.[0]?.score ?? 0 });
    });
    this.hands = hands;
    this.frameSeq++;
  }

  private releaseStream() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
    v.cancelVideoFrameCallback?.(this.vfcId);
    this.releaseStream();
    this.hands = [];
    this.busy = false;
    this.filters.clear();
    this.fps = 0;
    if (this.status !== 'denied' && this.status !== 'unavailable' && this.status !== 'error') this.set('idle');
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}
