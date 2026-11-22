import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveguideString } from '../public/worklets/virtuo-string-processor.js';

const SR = 48000;

function renderPluck(freq, seconds, setup = () => {}) {
  const s = new WaveguideString(SR);
  s.setFrequency(freq, true);
  setup(s);
  s.pluck(0.3, 0.8);
  const n = Math.floor(SR * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) s.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, n - i));
  return L;
}

// Autocorrelation pitch estimate with parabolic peak interpolation.
function pitch(x, from, len) {
  const seg = x.subarray(from, from + len);
  const minLag = Math.floor(SR / 2000), maxLag = Math.floor(SR / 40);
  const r = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < seg.length; i++) acc += seg[i] * seg[i + lag];
    r[lag] = acc / (seg.length - lag);
  }
  let best = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) if (r[lag] > r[best]) best = lag;
  const a = r[best - 1], b = r[best], c = r[best + 1];
  return SR / (best + 0.5 * (a - c) / (a - 2 * b + c));
}

for (const f of [82.41, 110, 196, 329.63, 659.25, 987.77]) {
  test(`waveguide is tuned within 6 cents at ${f} Hz`, () => {
    const out = renderPluck(f, 0.6);
    const est = pitch(out, SR * 0.1, 8192);
    const cents = 1200 * Math.log2(est / f);
    assert.ok(Math.abs(cents) < 6, `estimated ${est.toFixed(2)} Hz (${cents.toFixed(1)} cents off)`);
  });
}

test('output stays bounded and decays', () => {
  const out = renderPluck(220, 3);
  let early = 0, late = 0;
  for (let i = 0; i < out.length; i++) {
    assert.ok(Number.isFinite(out[i]));
    const a = Math.abs(out[i]);
    if (i < SR * 0.2) early = Math.max(early, a);
    if (i > SR * 2.6) late = Math.max(late, a);
  }
  assert.ok(early > 0.05 && early < 2, `early peak ${early}`);
  assert.ok(late < early * 0.2, `late ${late} vs early ${early}`);
});

test('muting damps the string far faster', () => {
  const open = renderPluck(220, 0.5);
  const muted = renderPluck(220, 0.5, s => s.setMuted(true));
  const tail = x => x.subarray(SR * 0.4).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(tail(muted) < tail(open) * 0.01);
});

test('raising tension (frequency) during a note glides the pitch', () => {
  const s = new WaveguideString(SR);
  s.setFrequency(220, true);
  s.pluck(0.3, 0.8);
  const n = SR;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    if (i >= SR / 2 && s.freq !== 246.94) s.setFrequency(246.94); // whole-tone bend
    s.render(L.subarray(i, i + 128), R.subarray(i, i + 128), 128);
  }
  assert.ok(Math.abs(pitch(L, SR * 0.1, 8192) - 220) < 2);
  assert.ok(Math.abs(pitch(L, SR * 0.7, 8192) - 246.94) < 2.5);
});

test('displacement shape is zero at both fixed ends right after a pluck', () => {
  const s = new WaveguideString(SR);
  s.setFrequency(110, true);
  s.pluck(0.5, 1);
  assert.ok(Math.abs(s.displacement(0)) < 0.05);
  assert.ok(Math.abs(s.displacement(1)) < 0.05);
  assert.ok(s.displacement(0.5) > 0.8);
});
