export type AudioStatus = 'off' | 'starting' | 'running' | 'suspended' | 'error' | 'unsupported';

export interface VoiceParams {
  freq?: number;
  t60?: number;
  brightness?: number;
  pan?: number;
  muted?: boolean;
  immediate?: boolean;
}

export interface StringShape {
  /** Instantaneous displacement at SHAPE_POINTS positions from nut (0) to bridge (1). */
  inst: Float32Array;
  /** Decaying peak envelope at the same positions. */
  env: Float32Array;
}

export const SHAPE_POINTS = 33;

type Listener = () => void;

/**
 * Main-thread side of the audio engine. Strings are voices inside one AudioWorklet
 * (public/worklets/virtuo-string-processor.js); this class only sends parameter/pluck
 * messages and receives the strings' displacement shapes for drawing.
 */
class AudioEngine {
  status: AudioStatus = 'off';
  error = '';
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private starting: Promise<boolean> | null = null;
  private shapes = new Map<string, StringShape>();
  private voices = new Set<string>();
  private listeners = new Set<Listener>();
  private volume = 0.8;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(status: AudioStatus, error = '') {
    this.status = status;
    this.error = error;
    this.listeners.forEach(fn => fn());
  }

  get running() {
    return this.status === 'running';
  }

  /** Must be called from a user gesture (click / key / touch) to satisfy autoplay rules. */
  start(): Promise<boolean> {
    if (this.status === 'running') return Promise.resolve(true);
    if (this.ctx && this.status === 'suspended') {
      return this.ctx.resume().then(() => {
        this.set('running');
        return true;
      });
    }
    this.starting ??= this.init().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async init(): Promise<boolean> {
    const AC = typeof window !== 'undefined' ? window.AudioContext : undefined;
    if (!AC || !('audioWorklet' in AC.prototype)) {
      this.set('unsupported', 'This browser does not support AudioWorklet.');
      return false;
    }
    this.set('starting');
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule('/worklets/virtuo-string-processor.js');
      const node = new AudioWorkletNode(ctx, 'virtuo-string', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      node.connect(comp).connect(master).connect(analyser).connect(ctx.destination);
      node.port.onmessage = e => this.onMessage(e.data);
      node.onprocessorerror = () => this.set('error', 'The audio processor crashed.');
      ctx.onstatechange = () => {
        if (ctx.state === 'running') this.set('running');
        else if (ctx.state === 'suspended' && this.status === 'running') this.set('suspended');
      };
      await ctx.resume();
      this.ctx = ctx;
      this.node = node;
      this.master = master;
      this.analyser = analyser;
      this.set(ctx.state === 'running' ? 'running' : 'suspended');
      return ctx.state === 'running';
    } catch (err) {
      this.set('error', (err as Error)?.message || 'Audio failed to start.');
      return false;
    }
  }

  private onMessage(msg: { type: string; ids: string[]; data: Float32Array }) {
    if (msg.type !== 'shapes') return;
    msg.ids.forEach((id, i) => {
      const base = i * SHAPE_POINTS * 2;
      let s = this.shapes.get(id);
      if (!s) {
        s = { inst: new Float32Array(SHAPE_POINTS), env: new Float32Array(SHAPE_POINTS) };
        this.shapes.set(id, s);
      }
      s.inst.set(msg.data.subarray(base, base + SHAPE_POINTS));
      s.env.set(msg.data.subarray(base + SHAPE_POINTS, base + SHAPE_POINTS * 2));
    });
  }

  private post(msg: Record<string, unknown>) {
    this.node?.port.postMessage(msg);
  }

  configure(id: string, params: VoiceParams) {
    this.voices.add(id);
    this.post({ type: 'set', id, ...params });
  }

  /** Excite string `id` at position pos ∈ (0,1) with amplitude amp, optionally delayed. */
  pluck(id: string, pos: number, amp: number, delaySec = 0) {
    if (!this.ctx) return;
    this.voices.add(id);
    this.post({ type: 'pluck', id, pos, amp, when: delaySec > 0 ? this.ctx.currentTime + delaySec : 0 });
  }

  remove(id: string) {
    this.voices.delete(id);
    this.shapes.delete(id);
    this.post({ type: 'remove', id });
  }

  removeWhere(prefix: string) {
    for (const id of [...this.voices]) if (id.startsWith(prefix)) this.remove(id);
  }

  shape(id: string): StringShape | undefined {
    return this.shapes.get(id);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  getVolume() {
    return this.volume;
  }

  async suspend() {
    if (this.ctx?.state === 'running') {
      await this.ctx.suspend();
      this.set('suspended');
    }
  }
}

export const audioEngine = new AudioEngine();

// Development-only handle for inspecting the live audio graph from devtools.
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __virtuoAudio: AudioEngine }).__virtuoAudio = audioEngine;
}
