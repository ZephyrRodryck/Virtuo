import test from 'node:test';
import assert from 'node:assert/strict';
import { FDString, bentTension, fundamental, modeAmplitudes, noteOf, snapToSemitone, tensionFor } from '../lib/physics/string.ts';
import { project, segmentIntersect } from '../lib/geometry.ts';
import { DEFAULT_CALIBRATION, pinchThresholds, poseFromLandmarks } from '../lib/tracking/hand.ts';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test("Mersenne's law and its inverse agree", () => {
  const T = tensionFor(110, 0.65, 0.0042);
  near(fundamental(0.65, T, 0.0042), 110, 1e-9);
  near(fundamental(1.3, T, 0.0042), 55, 1e-9); // doubling length halves pitch
  near(fundamental(0.65, 4 * T, 0.0042), 220, 1e-9); // 4× tension doubles pitch
});

test('bending raises tension, more with larger pull, none at zero', () => {
  assert.equal(bentTension(100, 0.65, 0.4, 0), 100);
  const small = bentTension(100, 0.65, 0.4, 0.01);
  const large = bentTension(100, 0.65, 0.4, 0.03);
  assert.ok(small > 100 && large > small);
  // ~3 cm pull on a guitar-length string is roughly a few semitones, not octaves
  const cents = 1200 * Math.log2(Math.sqrt(large / 100));
  assert.ok(cents > 100 && cents < 900, `${cents}`);
});

test('plucking at the middle silences even modes', () => {
  const A = modeAmplitudes(0.5, 6);
  for (const n of [2, 4, 6]) near(A[n - 1], 0, 1e-12);
  assert.ok(Math.abs(A[0]) > Math.abs(A[2]) && Math.abs(A[2]) > Math.abs(A[4])); // ∝ 1/n², alternating sign
});

test('note naming and semitone snapping', () => {
  assert.deepEqual(noteOf(440), { name: 'A4', cents: 0 });
  assert.equal(noteOf(82.41).name, 'E2');
  near(snapToSemitone(452), 440, 1e-9);
  near(snapToSemitone(116.2), 116.5409, 1e-3);
});

test('FD string keeps fixed ends, conserves roughly without damping and decays with it', () => {
  const s = new FDString(64);
  s.excite(0.3, 10);
  const p0 = s.peak();
  for (let i = 0; i < 200; i++) s.step(1 / 60, 3, 0);
  assert.equal(s.y[0], 0);
  assert.equal(s.y[63], 0);
  assert.ok(s.peak() > p0 * 0.5 && s.peak() < p0 * 1.5, 'undamped wave neither dies nor blows up');
  for (let i = 0; i < 600; i++) s.step(1 / 60, 3, 3);
  assert.ok(s.peak() < p0 * 0.05, 'damped wave decays');
});

test('segment intersection reports where and from which side a crossing happens', () => {
  const hit = segmentIntersect({ x: 5, y: -1 }, { x: 5, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(hit);
  near(hit.s, 0.5, 1e-9);
  near(hit.t, 0.5, 1e-9);
  const back = segmentIntersect({ x: 5, y: 1 }, { x: 5, y: -1 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.equal(back!.side, -hit.side);
  assert.equal(segmentIntersect({ x: 11, y: -1 }, { x: 11, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 }), null);
});

test('projection gives parameter, signed offset and distance', () => {
  const p = project({ x: 3, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  near(p.u, 0.3, 1e-9);
  near(p.offset, 2, 1e-9);
  near(p.dist, 2, 1e-9);
});

// Synthetic hand: wrist at origin, middle knuckle 100 px up, thumb tip and index tip `gap` px apart.
function hand(gap: number, fingersOut = true) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  lm[9] = { x: 0, y: -100 };
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    lm[pip] = { x: 0, y: -120 };
    lm[tip] = { x: 0, y: fingersOut ? -180 : -90 };
  }
  lm[4] = { x: -gap / 2, y: -170 };
  lm[8] = { x: gap / 2, y: -170 };
  return lm;
}

test('pinch uses hysteresis between the calibrated thresholds', () => {
  const { enter, exit } = pinchThresholds(DEFAULT_CALIBRATION);
  assert.ok(enter < exit);
  const between = ((enter + exit) / 2) * 100; // gap in px for a ratio between the thresholds
  assert.equal(poseFromLandmarks('Left', hand(between), false, DEFAULT_CALIBRATION, 0).pinching, false, 'not yet pinching → stays open');
  assert.equal(poseFromLandmarks('Left', hand(between), true, DEFAULT_CALIBRATION, 0).pinching, true, 'already pinching → stays pinched');
  assert.equal(poseFromLandmarks('Left', hand(enter * 100 - 5), false, DEFAULT_CALIBRATION, 0).pinching, true);
  assert.equal(poseFromLandmarks('Left', hand(exit * 100 + 5), true, DEFAULT_CALIBRATION, 0).pinching, false);
});

test('open palm needs all four fingers extended and no pinch', () => {
  assert.equal(poseFromLandmarks('Right', hand(90), false, DEFAULT_CALIBRATION, 0).open, true);
  assert.equal(poseFromLandmarks('Right', hand(90, false), false, DEFAULT_CALIBRATION, 0).open, false);
  assert.equal(poseFromLandmarks('Right', hand(5), false, DEFAULT_CALIBRATION, 0).open, false);
});
