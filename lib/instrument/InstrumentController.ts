import { audioEngine } from '../audio/AudioEngine';
import { clamp, dist, project, segmentIntersect, type Vec } from '../geometry';
import { DEFAULT_MU, FDString, bentTension, fundamental, noteOf, snapToSemitone, tensionFor } from '../physics/string';
import type { HandId, HandPose } from '../tracking/hand';
import { PRESETS, STRING_COLORS, type PresetId } from './presets';

export type Mode = 'freehand' | 'studio';
export type GestureKind = 'pinch' | 'create' | 'grab' | 'pluck' | 'strum' | 'slide' | 'bend' | 'tremolo' | 'mute';

/** Physical width represented by the full canvas width. */
const STAGE_METERS = 1.2;
const FREEHAND_T = tensionFor(110, 0.6, DEFAULT_MU); // a half-width string sounds A2
const MAX_STRINGS = 12;
const MIN_LENGTH_PX = 70;
const BEND_DEADZONE_PX = 6;

// Gesture state-machine thresholds
const CREATE_HOLD_MS = 120;     // camera pinch must be held this long before creation arms
const CREATE_LOCKOUT_MS = 300;  // per-hand lockout after a string is created
const STRUM_RECENCY_MS = 200;   // recent string crossing blocks creation arming
const MIN_PLUCK_SPEED = 0.5;    // hand-lengths/s crossing detection gate (was 0.8)
const RETRIGGER_MIN_MS = 40;    // minimum ms between re-triggers of the same string

export interface VString {
  id: string;
  a: Vec; // nut
  b: Vec; // bridge
  mu: number;
  T: number; // open-string tension (N)
  t60: number;
  brightness: number;
  color: string;
  fixed: boolean;
  stop: { u: number; offset: number; hand: HandId } | null;
  muted: boolean;
  freq: number;
  tension: number;
  lengthM: number;
  pan: number;
  sent: { freq: number; muted: boolean; pan: number };
  fd: FDString; // visual-only fallback when audio is unavailable
  lastPluck: number;
}

type Action =
  | { type: 'create'; start: Vec; t: number; partner?: HandId }
  | { type: 'pending-create'; start: Vec; t: number }
  | { type: 'grab'; id: string; end: 'a' | 'b' }
  | { type: 'stop'; id: string; lastU: number; lastSlide: number; lastBend: number };

interface HandState {
  pose: HandPose | null;
  prev: HandPose | null;
  lastSeen: number;
  action: Action | null;
  trail: Vec[];
  cooldown: Map<string, number>;
  crossings: Map<string, { t: number; dir: number }[]>;
  plucked: { id: string; t: number }[];
  lastStrum: number;
  lastTremolo: number;
  muting: Set<string>;
  lastCrossing: number;
  lastCreatedAt: number;
  lastSide: Map<string, number>;
}

export interface GestureEvent {
  n: number;
  kind: GestureKind;
  hand: HandId;
  label: string;
}

export interface StringInfo {
  id: string;
  note: string;
  cents: number;
  freq: number;
  lengthM: number;
  tension: number;
  color: string;
  muted: boolean;
  stopped: boolean;
}

export interface Snapshot {
  mode: Mode;
  preset: PresetId;
  snap: boolean;
  sustain: number;
  strings: StringInfo[];
  events: GestureEvent[];
  hands: { id: HandId; pinching: boolean; open: boolean }[];
}

export class InstrumentController {
  strings: VString[] = [];
  drafts: { a: Vec; b: Vec }[] = [];
  hands = new Map<HandId, HandState>();
  w = 1;
  h = 1;
  mode: Mode = 'freehand';
  preset: PresetId = 'guitar';
  snap = true;
  sustain = 3.2;

  private seq = 0;
  private eventSeq = 0;
  private events: GestureEvent[] = [];
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private snapshotKey = '';
  private lastSnapshotAt = 0;

  constructor() {
    this.snapshot = this.buildSnapshot();
  }

  get ppm() {
    return this.w / STAGE_METERS;
  }

  // ---------- external store (useSyncExternalStore) ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;

  private publish(force = false) {
    const snap = this.buildSnapshot();
    const key = JSON.stringify(snap);
    if (!force && key === this.snapshotKey) return;
    this.snapshotKey = key;
    this.snapshot = snap;
    this.listeners.forEach(fn => fn());
  }

  private buildSnapshot(): Snapshot {
    return {
      mode: this.mode,
      preset: this.preset,
      snap: this.snap,
      sustain: this.sustain,
      strings: this.strings.map(s => {
        const n = noteOf(s.freq);
        return {
          id: s.id,
          note: n.name,
          cents: n.cents,
          freq: Math.round(s.freq * 10) / 10,
          lengthM: Math.round(s.lengthM * 100) / 100,
          tension: Math.round(s.tension * 10) / 10,
          color: s.color,
          muted: s.muted,
          stopped: !!s.stop,
        };
      }),
      events: this.events.slice(),
      hands: [...this.hands.values()]
        .filter(h => h.pose)
        .map(h => ({ id: h.pose!.id, pinching: h.pose!.pinching, open: h.pose!.open })),
    };
  }

  private emit(kind: GestureKind, hand: HandId, label: string) {
    this.events = [{ n: ++this.eventSeq, kind, hand, label }, ...this.events].slice(0, 6);
    this.publish(true);
  }

  // ---------- configuration ----------
  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const sx = w / this.w, sy = h / this.h;
    this.w = w;
    this.h = h;
    if (this.mode === 'studio') this.layoutStudio();
    else for (const s of this.strings) for (const p of [s.a, s.b]) { p.x *= sx; p.y *= sy; }
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.clear();
    if (mode === 'studio') this.layoutStudio();
    this.publish(true);
  }

  setPreset(id: PresetId) {
    this.preset = id;
    if (this.mode === 'studio') {
      this.clear();
      this.layoutStudio();
    }
    this.publish(true);
  }

  setSnap(on: boolean) {
    this.snap = on;
    this.publish(true);
  }

  setSustain(t60: number) {
    this.sustain = t60;
    for (const s of this.strings) {
      s.t60 = t60;
      audioEngine.configure(s.id, { t60 });
    }
    this.publish(true);
  }

  private layoutStudio() {
    const p = PRESETS[this.preset];
    const count = p.strings.length;
    // Leave room for note labels on the right and the HUD panels above and below.
    const x0 = this.w * 0.08, x1 = this.w - Math.max(this.w * 0.1, 76);
    const top = Math.max(this.h * 0.24, 150), bottom = this.h - Math.max(this.h * 0.2, 150);
    const L = (x1 - x0) / this.ppm;
    const existing = this.strings.length === count;
    this.sustain = p.t60;
    p.strings.forEach((def, i) => {
      // Lowest string at the bottom, like looking down at a guitar neck.
      const y = bottom - (count === 1 ? 0 : (i / (count - 1)) * (bottom - top));
      const T = tensionFor(def.freq, L, def.mu);
      if (existing) {
        const s = this.strings[i];
        s.a = { x: x0, y };
        s.b = { x: x1, y };
        s.T = T;
      } else {
        this.addString({ x: x0, y }, { x: x1, y }, def.mu, T, p.brightness, true);
      }
    });
  }

  private addString(a: Vec, b: Vec, mu: number, T: number, brightness: number, fixed: boolean): VString | null {
    if (this.strings.length >= MAX_STRINGS) return null;
    const id = `s${++this.seq}`;
    const s: VString = {
      id, a, b, mu, T, brightness, fixed,
      t60: this.sustain,
      color: STRING_COLORS[(this.seq - 1) % STRING_COLORS.length],
      stop: null, muted: false, freq: 110, tension: T, lengthM: 0, pan: 0,
      sent: { freq: 0, muted: false, pan: 0 },
      fd: new FDString(64),
      lastPluck: 0,
    };
    this.strings.push(s);
    this.updatePhysics(s);
    audioEngine.configure(id, { freq: s.freq, t60: s.t60, brightness, pan: s.pan, muted: false, immediate: true });
    s.sent = { freq: s.freq, muted: false, pan: s.pan };
    return s;
  }

  removeString(id: string) {
    this.strings = this.strings.filter(s => s.id !== id);
    audioEngine.remove(id);
    for (const h of this.hands.values()) if (h.action && 'id' in h.action && h.action.id === id) h.action = null;
    this.publish(true);
  }

  removeLast() {
    const last = this.strings.filter(s => !s.fixed).at(-1);
    if (last) this.removeString(last.id);
  }

  clear() {
    for (const s of this.strings) audioEngine.remove(s.id);
    this.strings = [];
    this.drafts = [];
    for (const h of this.hands.values()) h.action = null;
    this.publish(true);
  }

  dispose() {
    this.clear();
    this.listeners.clear();
  }

  // ---------- geometry helpers ----------
  /** Start of the vibrating segment: the stop (finger contact) point, or the nut. */
  contact(s: VString): Vec {
    if (!s.stop) return s.a;
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: s.a.x + dx * s.stop.u + (-dy / len) * s.stop.offset,
      y: s.a.y + dy * s.stop.u + (dx / len) * s.stop.offset,
    };
  }

  private updatePhysics(s: VString) {
    const L = dist(s.a, s.b) / this.ppm;
    let T = s.T;
    if (this.mode === 'freehand' && this.snap && !s.fixed) T = tensionFor(snapToSemitone(fundamental(L, T, s.mu)), L, s.mu);
    let Lv = L;
    if (s.stop) {
      const d = Math.max(0, Math.abs(s.stop.offset) - BEND_DEADZONE_PX) / this.ppm;
      // Beyond ~2× tension a real string would snap; hold it at that limit.
      T = Math.min(bentTension(T, L, s.stop.u, d), 2 * T);
      Lv = Math.hypot((1 - s.stop.u) * L, d);
    }
    s.lengthM = L;
    s.tension = T;
    s.freq = clamp(fundamental(Math.max(0.01, Lv), T, s.mu), 25, 2400);
    s.pan = clamp(((s.a.x + s.b.x) / 2 / this.w) * 2 - 1, -1, 1) * 0.7;
  }

  private nearestEndpoint(p: Vec, radius: number) {
    let best: { s: VString; end: 'a' | 'b'; d: number } | null = null;
    for (const s of this.strings) {
      if (s.fixed) continue;
      for (const end of ['a', 'b'] as const) {
        const d = dist(p, s[end]);
        if (d < radius && (!best || d < best.d)) best = { s, end, d };
      }
    }
    return best;
  }

  private nearestBody(p: Vec, radius: number) {
    let best: { s: VString; u: number; offset: number; d: number } | null = null;
    for (const s of this.strings) {
      const pr = project(p, s.a, s.b);
      if (pr.u > 0.03 && pr.u < 0.92 && pr.dist < radius && (!best || pr.dist < best.d)) {
        best = { s, u: pr.u, offset: pr.offset, d: pr.dist };
      }
    }
    return best;
  }

  // ---------- gesture processing ----------
  private state(id: HandId): HandState {
    let st = this.hands.get(id);
    if (!st) {
      st = {
        pose: null, prev: null, lastSeen: 0, action: null, trail: [],
        cooldown: new Map(), crossings: new Map(), plucked: [],
        lastStrum: 0, lastTremolo: 0, muting: new Set(),
        lastCrossing: 0, lastCreatedAt: 0, lastSide: new Map(),
      };
      this.hands.set(id, st);
    }
    return st;
  }

  /**
   * Feeds the latest poses from one input source. Hands of that source that are
   * missing for more than 150 ms are treated as lost: their actions are cancelled.
   */
  ingest(poses: HandPose[], now: number, source: 'camera' | 'pointer') {
    const present = new Set(poses.map(p => p.id));
    for (const [id, st] of this.hands) {
      const isPointer = id === 'Pointer';
      if ((source === 'pointer') !== isPointer || present.has(id) || !st.pose) continue;
      // A pointer that leaves is gone at once; a camera hand may drop out for a frame or two.
      if (isPointer || now - st.lastSeen > 150) {
        if (st.action?.type === 'stop') this.releaseStop(st.action.id);
        st.action = null;
        st.pose = st.prev = null;
        st.trail.length = 0;
        st.muting.clear();
      }
    }
    for (const pose of poses) this.processHand(pose, now);
    this.updateDrafts();
  }

  private processHand(pose: HandPose, now: number) {
    const st = this.state(pose.id);
    st.prev = st.pose;
    st.pose = pose;
    st.lastSeen = now;
    st.trail.push({ x: pose.tip.x, y: pose.tip.y });
    if (st.trail.length > 16) st.trail.shift();

    const wasPinching = st.prev?.pinching ?? false;
    if (pose.pinching && !wasPinching) this.pinchStart(st, pose, now);
    else if (pose.pinching) this.pinchHold(st, pose, now);
    else if (wasPinching) this.pinchEnd(st, now);

    // Crossing detection runs unless the hand owns a deliberate action.
    // Transient pinch frames during a strum no longer block detection.
    const busy = st.action != null &&
      (st.action.type === 'grab' || st.action.type === 'stop' || st.action.type === 'create');
    if (!busy && st.prev) this.detectPlucks(st, pose, st.prev, now);
    this.detectMute(st, pose);
  }

  private pinchStart(st: HandState, pose: HandPose, now: number) {
    const p = pose.pinchPoint;
    const reach = Math.max(26, pose.scale * 0.4);
    const end = this.nearestEndpoint(p, reach);
    if (end) {
      st.action = { type: 'grab', id: end.s.id, end: end.end };
      this.emit('grab', pose.id, `${end.end === 'a' ? 'start' : 'end'} point · ${noteOf(end.s.freq).name}`);
      return;
    }
    const body = this.nearestBody(p, Math.max(22, pose.scale * 0.32));
    if (body) {
      body.s.stop = { u: body.u, offset: body.offset, hand: pose.id };
      st.action = { type: 'stop', id: body.s.id, lastU: body.u, lastSlide: now, lastBend: 0 };
      this.emit('pinch', pose.id, `stop ${noteOf(body.s.freq).name} at ${Math.round(body.u * 100)}%`);
      return;
    }
    if (this.mode !== 'freehand') {
      this.emit('pinch', pose.id, 'no string here');
      return;
    }
    // Pointer creation is immediate — no accidental pinch from tracking noise.
    if (pose.id === 'Pointer') {
      st.action = { type: 'create', start: { ...p }, t: now };
      this.emit('pinch', pose.id, 'drawing string');
      return;
    }
    // Camera hand: guard against accidental creation during strumming.
    if (now - st.lastCrossing < STRUM_RECENCY_MS) return;
    if (now - st.lastCreatedAt < CREATE_LOCKOUT_MS) return;
    st.action = { type: 'pending-create', start: { ...p }, t: now };
  }

  private pinchHold(st: HandState, pose: HandPose, now: number) {
    const a = st.action;
    if (!a) return;
    if (a.type === 'pending-create') {
      // Cancel if the hand crossed a string since the pinch started.
      if (st.lastCrossing > a.t) {
        st.action = null;
        return;
      }
      // Promote to full create after the hold duration.
      if (now - a.t < CREATE_HOLD_MS) return;
      let partner: HandId | undefined;
      for (const [id, other] of this.hands) {
        if (id === pose.id || id === 'Pointer' || pose.id === 'Pointer') continue;
        if (other.action?.type === 'create' && !other.action.partner && now - other.action.t < 500) {
          other.action.partner = pose.id;
          partner = id;
        }
      }
      st.action = { type: 'create', start: a.start, t: a.t, partner };
      this.emit('pinch', pose.id, partner ? 'two-hand string' : 'drawing string');
      return;
    }
    if (a.type === 'grab') {
      const s = this.strings.find(x => x.id === a.id);
      if (!s) return void (st.action = null);
      s[a.end] = { x: clamp(pose.pinchPoint.x, 0, this.w), y: clamp(pose.pinchPoint.y, 0, this.h) };
    } else if (a.type === 'stop') {
      const s = this.strings.find(x => x.id === a.id);
      if (!s || !s.stop) return void (st.action = null);
      const pr = project(pose.pinchPoint, s.a, s.b);
      s.stop.u = clamp(pr.u, 0.02, 0.9);
      s.stop.offset = clamp(pr.offset, -this.h * 0.25, this.h * 0.25);
      this.updatePhysics(s);
      const movedM = (Math.abs(s.stop.u - a.lastU) * dist(s.a, s.b)) / this.ppm;
      if (movedM > 0.02 && now - a.lastSlide > 250) {
        a.lastU = s.stop.u;
        a.lastSlide = now;
        this.emit('slide', pose.id, `→ ${noteOf(s.freq).name} · ${Math.round(s.freq)} Hz`);
      }
      const bend = Math.abs(s.stop.offset) - BEND_DEADZONE_PX;
      if (bend > 12 && now - a.lastBend > 400) {
        a.lastBend = now;
        const open = this.unbentFreq(s);
        this.emit('bend', pose.id, `+${Math.round(1200 * Math.log2(s.freq / open))}¢ → ${noteOf(s.freq).name}`);
      }
    }
  }

  private unbentFreq(s: VString) {
    const saved = s.stop!.offset;
    s.stop!.offset = 0;
    this.updatePhysics(s);
    const f = s.freq;
    s.stop!.offset = saved;
    this.updatePhysics(s);
    return f;
  }

  private pinchEnd(st: HandState, now: number) {
    const a = st.action;
    st.action = null;
    if (!a) return;
    if (a.type === 'stop') this.releaseStop(a.id);
    if (a.type !== 'create') return;
    const me = st.pose!;
    let from = a.start;
    const to = me.pinchPoint;
    const partnerSt = a.partner ? this.hands.get(a.partner) : undefined;
    if (partnerSt?.pose && partnerSt.action?.type === 'create') {
      from = partnerSt.pose.pinchPoint;
      partnerSt.action = null;
    } else {
      // The partner may have released first and handed creation back to us.
      for (const other of this.hands.values()) {
        if (other.action?.type === 'create' && other.action.partner === me.id) other.action.partner = undefined;
      }
    }
    if (dist(from, to) < MIN_LENGTH_PX) return;
    const s = this.addString({ ...from }, { ...to }, DEFAULT_MU, FREEHAND_T, 0.7, false);
    if (!s) return this.emit('create', me.id, `limit of ${MAX_STRINGS} strings`);
    this.excite(s, 0.5, 0.35, 0);
    this.emit('create', me.id, `string ${noteOf(s.freq).name} · ${s.lengthM.toFixed(2)} m`);
    st.lastCreatedAt = now;
  }

  private releaseStop(id: string) {
    const s = this.strings.find(x => x.id === id);
    if (s) s.stop = null;
  }

  private updateDrafts() {
    this.drafts = [];
    for (const [id, st] of this.hands) {
      const a = st.action;
      if (!st.pose) continue;
      if (a?.type === 'create') {
        const partner = a.partner ? this.hands.get(a.partner) : undefined;
        if (partner?.pose && partner.action?.type === 'create') {
          if (id < a.partner!) this.drafts.push({ a: partner.pose.pinchPoint, b: st.pose.pinchPoint });
        } else {
          this.drafts.push({ a: a.start, b: st.pose.pinchPoint });
        }
      } else if (a?.type === 'pending-create') {
        this.drafts.push({ a: a.start, b: st.pose.pinchPoint });
      }
    }
  }

  /** Fingertip path prev→tip crossing a string's vibrating segment plucks it. */
  private detectPlucks(st: HandState, pose: HandPose, prev: HandPose, now: number) {
    // Cap the gap so a fingertip resting before a flick is not averaged into a slow move.
    const dt = Math.min(120, Math.max(1, pose.time - prev.time)) / 1000;
    const speed = dist(pose.tip, prev.tip) / dt / pose.scale; // hand-lengths per second
    if (speed < MIN_PLUCK_SPEED) return;
    const hits: { s: VString; t: number; pos: number; dir: number }[] = [];
    const hitIds = new Set<string>();
    for (const s of this.strings) {
      if ((st.cooldown.get(s.id) ?? 0) > now) continue;
      const hit = segmentIntersect(prev.tip, pose.tip, this.contact(s), s.b);
      if (!hit) continue;
      hits.push({ s, t: hit.t, pos: hit.s, dir: hit.side });
      hitIds.add(s.id);
    }
    // Also test middle fingertip for camera hands (wider sweep coverage).
    if (pose.landmarks && prev.landmarks) {
      const midCur = pose.landmarks[12];
      const midPrev = prev.landmarks[12];
      for (const s of this.strings) {
        if (hitIds.has(s.id)) continue;
        if ((st.cooldown.get(s.id) ?? 0) > now) continue;
        const hit = segmentIntersect(midPrev, midCur, this.contact(s), s.b);
        if (hit) hits.push({ s, t: hit.t, pos: hit.s, dir: hit.side });
      }
    }
    if (!hits.length) return;
    // Cancel pending creation — the hand is strumming, not creating.
    if (st.action?.type === 'pending-create') st.action = null;
    st.lastCrossing = now;
    hits.sort((x, y) => x.t - y.t);
    const amp = clamp(speed / 10, 0.12, 1);
    for (const h of hits) {
      st.cooldown.set(h.s.id, now + RETRIGGER_MIN_MS);
      st.lastSide.set(h.s.id, h.dir);
      this.excite(h.s, h.pos, amp, h.t * dt);
      st.plucked.push({ id: h.s.id, t: now });
      const list = st.crossings.get(h.s.id) ?? [];
      list.push({ t: now, dir: h.dir });
      st.crossings.set(h.s.id, list.filter(c => now - c.t < 600));
    }
    st.plucked = st.plucked.filter(p => now - p.t < 180);
    const distinct = new Set(st.plucked.map(p => p.id));
    if (distinct.size >= 2) {
      if (now - st.lastStrum > 300) this.emit('strum', pose.id, `${distinct.size} strings`);
      st.lastStrum = now;
      return;
    }
    const s = hits[0].s;
    const cs = st.crossings.get(s.id)!;
    let alternations = 0;
    for (let i = 1; i < cs.length; i++) if (cs[i].dir !== cs[i - 1].dir) alternations++;
    if (alternations >= 2) {
      if (now - st.lastTremolo > 400) this.emit('tremolo', pose.id, `${noteOf(s.freq).name}`);
      st.lastTremolo = now;
    } else if (now - st.lastTremolo > 400) {
      this.emit('pluck', pose.id, `${noteOf(s.freq).name} · ${Math.round(s.freq)} Hz`);
    }
  }

  private detectMute(st: HandState, pose: HandPose) {
    const newly: VString[] = [];
    st.muting.clear();
    if (pose.open) {
      const r = pose.scale * 0.6;
      for (const s of this.strings) {
        if (project(pose.palm, this.contact(s), s.b).dist < r) {
          if (!s.muted) newly.push(s);
          st.muting.add(s.id);
        }
      }
    }
    if (newly.length) {
      this.emit('mute', pose.id, newly.map(s => noteOf(s.freq).name).join(' '));
    }
  }

  private excite(s: VString, pos: number, amp: number, delaySec: number) {
    s.lastPluck = performance.now();
    if (audioEngine.running) audioEngine.pluck(s.id, pos, amp, delaySec);
    else s.fd.excite(pos, amp);
  }

  /** Strums all strings in order — used by the on-screen "strum" control. */
  strumAll() {
    this.strings.forEach((s, i) => this.excite(s, 0.3, 0.7, i * 0.025));
    if (this.strings.length) this.emit('strum', 'Pointer', `${this.strings.length} strings`);
  }

  // ---------- per-frame update ----------
  tick(now: number, dt: number) {
    const muted = new Set<string>();
    for (const st of this.hands.values()) if (st.pose) st.muting.forEach(id => muted.add(id));
    for (const s of this.strings) {
      s.muted = muted.has(s.id);
      this.updatePhysics(s);
      const sent = s.sent;
      const params: { freq?: number; muted?: boolean; pan?: number } = {};
      if (Math.abs(s.freq - sent.freq) > s.freq * 0.0003) params.freq = sent.freq = s.freq;
      if (s.muted !== sent.muted) params.muted = sent.muted = s.muted;
      if (Math.abs(s.pan - sent.pan) > 0.05) params.pan = sent.pan = s.pan;
      if (Object.keys(params).length) audioEngine.configure(s.id, params);
      if (!audioEngine.running) {
        // Same wave equation at visual rate; speed grows with pitch so higher strings move faster.
        s.fd.step(dt, 2 + Math.log2(s.freq / 40) * 2.5, s.muted ? 25 : 3 / s.t60);
      }
    }
    if (now - this.lastSnapshotAt > 150) {
      this.lastSnapshotAt = now;
      this.publish();
    }
  }
}
