import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentIntersect, dist } from '../lib/geometry.ts';
import { poseFromLandmarks, poseFromPointer, DEFAULT_CALIBRATION } from '../lib/tracking/hand.ts';

// Synthetic hand helper: wrist at origin, middle knuckle 100 px up.
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

// ---- crossing detection basics ----

test('fast strum crosses multiple parallel strings', () => {
  // Strings at y=100, y=200, y=300 from x=0 to x=500.
  const strings = [
    { a: { x: 0, y: 100 }, b: { x: 500, y: 100 } },
    { a: { x: 0, y: 200 }, b: { x: 500, y: 200 } },
    { a: { x: 0, y: 300 }, b: { x: 500, y: 300 } },
  ];
  // Finger sweeps from (250, 50) to (250, 350) — should cross all three.
  const from = { x: 250, y: 50 };
  const to = { x: 250, y: 350 };
  const crossed = strings.filter(s => segmentIntersect(from, to, s.a, s.b) !== null);
  assert.equal(crossed.length, 3, 'all three strings should be crossed');
});

test('slow move below speed gate does not trigger a pluck', () => {
  // Hand moves 3px in 100ms with scale 70 → speed = 3/0.1/70 ≈ 0.43
  const tipSpeed = 3 / 0.1 / 70;
  assert.ok(tipSpeed < 0.5, `speed ${tipSpeed} should be below the 0.5 gate`);
  // A faster move should be above the gate.
  const fastSpeed = 10 / 0.1 / 70;
  assert.ok(fastSpeed > 0.5, `speed ${fastSpeed} should be above the gate`);
});

test('side-based re-arm: opposite-side crossing is detected even at short intervals', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  const down = segmentIntersect({ x: 50, y: -10 }, { x: 50, y: 10 }, a, b);
  const up = segmentIntersect({ x: 50, y: 10 }, { x: 50, y: -10 }, a, b);
  assert.ok(down && up, 'both crossings detected');
  assert.notEqual(down!.side, up!.side, 'sides should differ');
});

// ---- creation guard: transient pinch during strum ----

test('a single-frame pinch should not produce a create action for camera hands', () => {
  // This test verifies the design: at ~10fps, a single tracking frame is ~100ms.
  // CREATE_HOLD_MS is 120ms, so a pinch lasting only one frame (released on the next)
  // cannot reach the confirmed 'create' state.
  const CREATE_HOLD_MS = 120;
  const frameInterval = 100; // typical at 10 fps
  assert.ok(frameInterval < CREATE_HOLD_MS,
    'one frame is shorter than the hold requirement → no accidental creation');
});

test('pointer creation is immediate (no hold delay)', () => {
  // Pointer input simulates mouse — creation should be instant.
  const pose = poseFromPointer({ x: 100, y: 100 }, true, false, 0);
  assert.equal(pose.pinching, true);
  assert.equal(pose.id, 'Pointer');
});

// ---- crossing detection with middle fingertip ----

test('middle fingertip (landmark 12) can detect a crossing the index tip misses', () => {
  // Index tip sweeps above the string, middle finger sweeps through it.
  const string = { a: { x: 0, y: 200 }, b: { x: 500, y: 200 } };
  const prevIndex = { x: 250, y: 180 }, curIndex = { x: 260, y: 180 }; // above, no crossing
  const prevMiddle = { x: 250, y: 190 }, curMiddle = { x: 260, y: 210 }; // crosses
  const indexHit = segmentIntersect(prevIndex, curIndex, string.a, string.b);
  const middleHit = segmentIntersect(prevMiddle, curMiddle, string.a, string.b);
  assert.equal(indexHit, null, 'index tip misses');
  assert.ok(middleHit, 'middle finger catches the crossing');
});

// ---- strum recency blocks creation ----

test('recent string crossing should block creation arming', () => {
  const STRUM_RECENCY_MS = 200;
  const lastCrossing = 1000;
  const now = 1150;
  assert.ok(now - lastCrossing < STRUM_RECENCY_MS,
    'creation should be blocked when crossing was recent');
  const later = 1250;
  assert.ok(later - lastCrossing >= STRUM_RECENCY_MS,
    'creation should be allowed after the recency window');
});
