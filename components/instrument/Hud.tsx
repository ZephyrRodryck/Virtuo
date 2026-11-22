'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { AudioStatus } from '@/lib/audio/AudioEngine';
import { audioEngine } from '@/lib/audio/AudioEngine';
import type { Mode, Snapshot } from '@/lib/instrument/InstrumentController';
import { PRESETS, type PresetId } from '@/lib/instrument/presets';
import type { CameraStatus } from '@/lib/tracking/HandTracker';

interface Props {
  snapshot: Snapshot;
  camera: CameraStatus;
  audio: AudioStatus;
  trackInfo: string;
  showVideo: boolean;
  onShowVideo: (v: boolean) => void;
  onMode: (m: Mode) => void;
  onPreset: (p: PresetId) => void;
  onSnap: (v: boolean) => void;
  onSustain: (v: number) => void;
  onClear: () => void;
  onStrum: () => void;
  onRemove: (id: string) => void;
  onRecalibrate: () => void;
  onToggleCamera: () => void;
  onStartAudio: () => void;
}

const panel = { border: '1px solid var(--border)', background: 'rgba(4,4,10,0.78)', backdropFilter: 'blur(6px)' } as const;
const label = 'font-mono-math text-[10px] tracking-[0.2em] uppercase';

function Dot({ on, warn }: { on: boolean; warn?: boolean }) {
  return (
    <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"
      style={{ background: on ? '#5fd6c0' : warn ? '#ffa86b' : 'var(--text-3)' }} />
  );
}

export default function Hud(p: Props) {
  const s = p.snapshot;
  const [volume, setVolume] = useState(audioEngine.getVolume());
  const [help, setHelp] = useState(false);
  const left = s.hands.find(h => h.id === 'Left');
  const right = s.hands.find(h => h.id === 'Right');

  return (
    <>
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 md:px-6 py-3 pointer-events-none">
        <Link href="/" className="pointer-events-auto font-semibold text-sm tracking-widest mr-2" style={{ color: 'var(--text-1)' }}>
          ← VIRTUO
        </Link>
        <div className="pointer-events-auto flex" style={panel} role="group" aria-label="Instrument mode">
          {(['freehand', 'studio'] as Mode[]).map(m => (
            <button key={m} onClick={() => p.onMode(m)} aria-pressed={s.mode === m}
              className={`${label} px-3 py-2`}
              style={{ color: s.mode === m ? 'var(--accent)' : 'var(--text-3)', background: s.mode === m ? 'var(--surface)' : 'transparent' }}>
              {m}
            </button>
          ))}
        </div>
        {s.mode === 'studio' ? (
          <select value={s.preset} onChange={e => p.onPreset(e.target.value as PresetId)}
            className={`pointer-events-auto ${label} px-2 py-2`} style={{ ...panel, color: 'var(--text-2)' }} aria-label="Preset">
            {(Object.keys(PRESETS) as PresetId[]).map(id => <option key={id} value={id}>{PRESETS[id].label}</option>)}
          </select>
        ) : (
          <label className={`pointer-events-auto ${label} px-3 py-2 flex items-center gap-2 cursor-pointer`} style={{ ...panel, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={s.snap} onChange={e => p.onSnap(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            snap to semitone
          </label>
        )}
        <div className="flex-1" />
        <label className={`pointer-events-auto ${label} hidden sm:flex items-center gap-2 px-3 py-2`} style={{ ...panel, color: 'var(--text-2)' }}>
          sustain
          <input type="range" min={0.5} max={8} step={0.1} value={s.sustain} onChange={e => p.onSustain(Number(e.target.value))}
            className="w-20" style={{ accentColor: 'var(--accent)' }} aria-label="Sustain (T60 seconds)" />
          <span style={{ color: 'var(--accent)' }}>{s.sustain.toFixed(1)}s</span>
        </label>
        <label className={`pointer-events-auto ${label} hidden sm:flex items-center gap-2 px-3 py-2`} style={{ ...panel, color: 'var(--text-2)' }}>
          vol
          <input type="range" min={0} max={1} step={0.01} value={volume}
            onChange={e => { const v = Number(e.target.value); setVolume(v); audioEngine.setVolume(v); }}
            className="w-20" style={{ accentColor: 'var(--accent)' }} aria-label="Volume" />
        </label>
        <button onClick={p.onStrum} className={`pointer-events-auto ${label} px-3 py-2`} style={{ ...panel, color: 'var(--text-2)' }}>strum</button>
        {s.mode === 'freehand' && (
          <button onClick={p.onClear} className={`pointer-events-auto ${label} px-3 py-2`} style={{ ...panel, color: 'var(--text-2)' }}>clear</button>
        )}
        <button onClick={() => setHelp(h => !h)} aria-expanded={help} className={`pointer-events-auto ${label} px-3 py-2`} style={{ ...panel, color: 'var(--text-2)' }}>?</button>
      </div>

      {help && (
        <div className="absolute top-16 right-4 md:right-6 w-[min(22rem,calc(100vw-2rem))] p-5 text-sm space-y-2 z-10" style={{ ...panel, color: 'var(--text-2)' }}>
          <p className={label} style={{ color: 'var(--accent)' }}>Gestures</p>
          <p><b style={{ color: 'var(--text-1)' }}>Create</b> — pinch in empty space and pull (one hand), or pinch with both hands and pull apart. Mouse: drag.</p>
          <p><b style={{ color: 'var(--text-1)' }}>Pluck / strum</b> — flick your index fingertip across one or several strings. Mouse: move across.</p>
          <p><b style={{ color: 'var(--text-1)' }}>Tremolo</b> — rub quickly back and forth across one string.</p>
          <p><b style={{ color: 'var(--text-1)' }}>Slide / bend</b> — pinch on a string, move along it to change length, pull sideways to raise tension. Mouse: press on a string.</p>
          <p><b style={{ color: 'var(--text-1)' }}>Move endpoint</b> — pinch an endpoint and drag (Freehand).</p>
          <p><b style={{ color: 'var(--text-1)' }}>Mute</b> — open palm over a string. Mouse: hold Shift.</p>
          <p className="font-mono-math text-xs" style={{ color: 'var(--text-3)' }}>Space strums all · Delete removes the last string</p>
        </div>
      )}

      {/* Status */}
      <div className="absolute left-4 md:left-6 bottom-4 p-4 space-y-1.5 font-mono-math text-[11px]" style={{ ...panel, color: 'var(--text-2)' }}>
        <p><Dot on={p.camera === 'running'} warn={p.camera === 'denied' || p.camera === 'error'} />camera {p.camera}{p.trackInfo ? ` · ${p.trackInfo}` : ''}</p>
        {p.camera === 'running' && (
          <p>
            <Dot on={!!left} />L {left ? (left.pinching ? 'pinch' : left.open ? 'open' : 'tracked') : '—'}
            <span className="mx-2" style={{ color: 'var(--text-3)' }}>/</span>
            <Dot on={!!right} />R {right ? (right.pinching ? 'pinch' : right.open ? 'open' : 'tracked') : '—'}
          </p>
        )}
        <p><Dot on={p.audio === 'running'} warn={p.audio === 'error' || p.audio === 'unsupported' || p.audio === 'suspended'} />audio {p.audio}
          {p.audio !== 'running' && p.audio !== 'starting' && (
            <button onClick={p.onStartAudio} className="ml-2 underline" style={{ color: 'var(--accent)' }}>enable</button>
          )}
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button onClick={p.onToggleCamera} className="underline">{p.camera === 'running' ? 'camera off' : 'camera on'}</button>
          {p.camera === 'running' && <button onClick={p.onRecalibrate} className="underline">recalibrate</button>}
          {p.camera === 'running' && <button onClick={() => p.onShowVideo(!p.showVideo)} className="underline">{p.showVideo ? 'hide video' : 'show video'}</button>}
        </div>
      </div>

      {/* Gesture feed */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-1 pointer-events-none" aria-live="polite">
        {s.events.slice(0, 3).map((e, i) => (
          <p key={e.n} className="font-mono-math text-xs" style={{ color: i === 0 ? 'var(--text-1)' : 'var(--text-3)', opacity: 1 - i * 0.3 }}>
            <span style={{ color: 'var(--accent)' }}>{e.kind}</span> · {e.label}
          </p>
        ))}
        {!s.events.length && (
          <p className="font-mono-math text-xs" style={{ color: 'var(--text-3)' }}>
            {s.mode === 'freehand' ? 'pinch and pull apart to draw a string' : 'flick across the strings to play'}
          </p>
        )}
      </div>

      {/* Strings */}
      {!!s.strings.length && (
        <div className="absolute right-4 md:right-6 bottom-4 w-60 max-h-[45vh] overflow-y-auto hidden sm:block font-mono-math text-[11px]" style={panel}>
          <p className={`${label} px-4 pt-3 pb-2`} style={{ color: 'var(--text-3)' }}>{s.strings.length} strings</p>
          {s.strings.map(str => (
            <div key={str.id} className="flex items-center gap-3 px-4 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="w-1 h-6" style={{ background: str.color, opacity: str.muted ? 0.3 : 1 }} />
              <div className="flex-1" style={{ color: 'var(--text-2)' }}>
                <p style={{ color: 'var(--text-1)' }}>{str.note} <span style={{ color: 'var(--text-3)' }}>{str.cents >= 0 ? '+' : ''}{str.cents}¢</span> · {str.freq} Hz</p>
                <p>L {str.lengthM} m · T {str.tension} N{str.stopped ? ' · stopped' : ''}</p>
              </div>
              {s.mode === 'freehand' && (
                <button onClick={() => p.onRemove(str.id)} aria-label={`Remove ${str.note} string`} className="px-1" style={{ color: 'var(--text-3)' }}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
