'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audioEngine, type AudioStatus } from '@/lib/audio/AudioEngine';
import { InstrumentController } from '@/lib/instrument/InstrumentController';
import type { PresetId } from '@/lib/instrument/presets';
import { renderInstrument } from '@/lib/instrument/render';
import { Calibrator, loadCalibration } from '@/lib/tracking/calibration';
import { DEFAULT_CALIBRATION, coverMap, poseFromLandmarks, poseFromPointer, type PinchCalibration } from '@/lib/tracking/hand';
import { HandTracker, type CameraStatus } from '@/lib/tracking/HandTracker';
import Hud from './Hud';

type Phase = 'start' | 'camera' | 'calibrate' | 'play';

export default function InstrumentApp() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [controller] = useState(() => new InstrumentController());
  const trackerRef = useRef<HandTracker | null>(null);
  const calRef = useRef<PinchCalibration>(DEFAULT_CALIBRATION);
  const calibratorRef = useRef<Calibrator | null>(null);
  const lastHandsAt = useRef(0);

  const [phase, setPhase] = useState<Phase>('start');
  const [cam, setCam] = useState<{ status: CameraStatus; error: string }>({ status: 'idle', error: '' });
  const [calib, setCalib] = useState({ step: 'open', progress: 0 });
  const [showVideo, setShowVideo] = useState(true);
  const [handsLost, setHandsLost] = useState(false);
  const [trackInfo, setTrackInfo] = useState('');
  const audio = useSyncExternalStore(audioEngine.subscribe.bind(audioEngine), (): AudioStatus => audioEngine.status, (): AudioStatus => 'off');
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Tracker lifetime = component lifetime; camera is only opened on request.
  useEffect(() => {
    const tracker = new HandTracker(videoRef.current!);
    trackerRef.current = tracker;
    const off = tracker.subscribe(() => setCam({ status: tracker.status, error: tracker.error }));
    calRef.current = loadCalibration() ?? DEFAULT_CALIBRATION;
    return () => {
      off();
      tracker.dispose();
      controller.dispose();
    };
  }, [controller]);

  // Render + gesture loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let seq = -1;
    let uiAt = 0;

    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      controller.resize(r.width, r.height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    resize();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tracker = trackerRef.current;
      if (tracker && tracker.status === 'running' && tracker.frameSeq !== seq) {
        seq = tracker.frameSeq;
        const poses = tracker.hands.map(h => {
          const lm = h.points.map(p => coverMap(p.x, p.y, tracker.videoWidth, tracker.videoHeight, controller.w, controller.h));
          const prev = controller.hands.get(h.id)?.pose?.pinching ?? false;
          return poseFromLandmarks(h.id, lm, prev, calRef.current, tracker.frameTime);
        });
        if (poses.length) lastHandsAt.current = now;
        const cal = calibratorRef.current;
        if (phaseRef.current === 'calibrate' && cal) {
          const p = poses[0];
          if (cal.feed(p ? p.pinchRatio : null, p ? p.open : false) && cal.step === 'done') {
            calRef.current = cal.result;
            setPhase('play');
          }
          setCalib({ step: cal.step, progress: cal.progress });
        } else {
          controller.ingest(poses, now, 'camera');
        }
      }
      controller.tick(now, dt);
      renderInstrument(ctx, controller, calRef.current);
      if (now - uiAt > 250) {
        uiAt = now;
        const t = trackerRef.current;
        setHandsLost(!!t && t.status === 'running' && now - lastHandsAt.current > 1500);
        setTrackInfo(t?.status === 'running' ? `${Math.round(t.fps)} fps · ${t.backend} · ${Math.round(t.inferenceMs)} ms` : '');
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [controller]);

  // Pointer input (mouse / touch / pen): button = pinch, Shift = open-palm mute.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let down = false;
    let shift = false;
    let last: { x: number; y: number } | null = null;
    const feed = (e: PointerEvent | null) => {
      if (phaseRef.current !== 'play') return;
      if (!e) return controller.ingest([], performance.now(), 'pointer');
      const r = canvas.getBoundingClientRect();
      last = { x: e.clientX - r.left, y: e.clientY - r.top };
      controller.ingest([poseFromPointer(last, down, shift, e.timeStamp)], performance.now(), 'pointer');
    };
    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort: drags still work while the pointer stays over the canvas.
      }
      down = true;
      feed(e);
    };
    const onMove = (e: PointerEvent) => {
      // Coalesced events keep fast flicks from skipping over strings.
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) feed(ev);
    };
    const onUp = (e: PointerEvent) => {
      down = false;
      feed(e);
    };
    const onLeave = () => feed(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shift = e.type === 'keydown';
        if (last) controller.ingest([poseFromPointer(last, down, shift, performance.now())], performance.now(), 'pointer');
      }
      if (e.type !== 'keydown' || phaseRef.current !== 'play') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, select, button, textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') controller.removeLast();
      if (e.key === ' ') {
        e.preventDefault();
        controller.strumAll();
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [controller]);

  const beginCalibration = useCallback(() => {
    calibratorRef.current = new Calibrator();
    setCalib({ step: 'open', progress: 0 });
    setPhase('calibrate');
  }, []);

  const startCamera = useCallback(async () => {
    setPhase('camera');
    await audioEngine.start();
    const tracker = trackerRef.current!;
    await tracker.start();
    if (tracker.status !== 'running') return;
    if (loadCalibration()) setPhase('play');
    else beginCalibration();
  }, [beginCalibration]);

  const startPointer = useCallback(async () => {
    trackerRef.current?.stop();
    await audioEngine.start();
    setPhase('play');
  }, []);

  const skipCalibration = () => {
    calRef.current = loadCalibration() ?? DEFAULT_CALIBRATION;
    setPhase('play');
  };

  const toggleCamera = () => {
    const t = trackerRef.current!;
    if (t.status === 'running') t.stop();
    else void startCamera();
  };

  const camFailed = cam.status === 'denied' || cam.status === 'unavailable' || cam.status === 'error';

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: 'var(--bg)' }}>
      <div ref={wrapRef} className="absolute inset-0">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{
            transform: 'scaleX(-1)',
            opacity: cam.status === 'running' && showVideo ? 0.28 : 0,
            filter: 'grayscale(1) contrast(1.1)',
            transition: 'opacity 400ms',
          }}
          muted
          playsInline
          aria-hidden
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none', cursor: phase === 'play' ? 'crosshair' : 'default' }}
          aria-label="Instrument surface. Drag to draw a string, move across a string to pluck it."
        />
      </div>

      {phase === 'play' && (
        <Hud
          snapshot={snapshot}
          camera={cam.status}
          audio={audio}
          trackInfo={trackInfo}
          showVideo={showVideo}
          onShowVideo={setShowVideo}
          onMode={m => controller.setMode(m)}
          onPreset={(p: PresetId) => controller.setPreset(p)}
          onSnap={v => controller.setSnap(v)}
          onSustain={v => controller.setSustain(v)}
          onClear={() => controller.clear()}
          onStrum={() => controller.strumAll()}
          onRemove={id => controller.removeString(id)}
          onRecalibrate={beginCalibration}
          onToggleCamera={toggleCamera}
          onStartAudio={() => void audioEngine.start()}
        />
      )}

      {phase === 'play' && handsLost && (
        <div role="status" className="absolute top-20 left-1/2 -translate-x-1/2 px-4 py-2 font-mono-math text-xs"
          style={{ border: '1px solid var(--border)', background: 'rgba(4,4,10,0.8)', color: 'var(--text-2)' }}>
          No hands in view — raise your hands in front of the camera
        </div>
      )}

      {phase !== 'play' && (
        <div className="absolute inset-0 flex items-center justify-center px-5" style={{ background: 'rgba(4,4,10,0.82)' }}>
          <div className="w-full max-w-lg">
            {phase === 'start' && (
              <StartPanel onCamera={startCamera} onPointer={startPointer} />
            )}
            {phase === 'camera' && !camFailed && (
              <Panel label="Starting">
                <p className="text-lg" style={{ color: 'var(--text-1)' }}>
                  {cam.status === 'requesting' ? 'Waiting for camera permission…' : 'Loading the hand-tracking model…'}
                </p>
                <p className="mt-3 text-sm" style={{ color: 'var(--text-2)' }}>
                  The 7.5 MB model loads once and runs on this device. Video never leaves your browser.
                </p>
              </Panel>
            )}
            {phase === 'camera' && camFailed && (
              <Panel label="Camera unavailable">
                <p className="text-lg" style={{ color: 'var(--text-1)' }}>{cam.error}</p>
                {cam.status === 'denied' && (
                  <p className="mt-3 text-sm" style={{ color: 'var(--text-2)' }}>
                    Allow camera access from the icon in your browser’s address bar, then retry.
                  </p>
                )}
                <div className="mt-8 flex flex-wrap gap-3">
                  <button className="btn-primary" onClick={startCamera}>Retry camera</button>
                  <button className="btn-ghost" onClick={startPointer}>Continue with mouse / touch</button>
                </div>
              </Panel>
            )}
            {phase === 'calibrate' && (
              <Panel label={`Calibration · step ${calib.step === 'open' ? 1 : 2} of 2`}>
                <p className="text-2xl font-medium" style={{ color: 'var(--text-1)' }}>
                  {calib.step === 'open' ? 'Hold one hand up, fingers spread.' : 'Now pinch your thumb and index finger together.'}
                </p>
                <p className="mt-3 text-sm" style={{ color: 'var(--text-2)' }}>
                  Keep still until the bar fills. This measures your hand so pinch detection fits you.
                </p>
                <div className="mt-6 h-px w-full" style={{ background: 'var(--border)' }}>
                  <div className="h-px" style={{ width: `${Math.round(calib.progress * 100)}%`, background: 'var(--accent)', transition: 'width 120ms' }} />
                </div>
                <div className="mt-8 flex gap-3">
                  <button className="btn-ghost" onClick={skipCalibration}>Skip — use defaults</button>
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-8" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
      <p className="font-mono-math text-xs tracking-[0.25em] mb-6" style={{ color: 'var(--accent)' }}>{label.toUpperCase()}</p>
      {children}
    </div>
  );
}

function StartPanel({ onCamera, onPointer }: { onCamera: () => void; onPointer: () => void }) {
  return (
    <Panel label="Virtuo / instrument">
      <h1 className="font-semibold leading-none" style={{ fontSize: 'clamp(2.2rem, 7vw, 3.4rem)', color: 'var(--text-1)' }}>
        Your hands are<br /><span style={{ color: 'var(--text-2)', fontWeight: 300 }}>the instrument.</span>
      </h1>
      <ul className="mt-6 space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
        <li>Pinch in the air and pull apart to draw a string.</li>
        <li>Flick your index finger across it to pluck. Sweep across several to strum.</li>
        <li>Pinch a string to stop it, slide along it, pull sideways to bend. Open palm over it mutes.</li>
      </ul>
      <p className="mt-5 font-mono-math text-xs" style={{ color: 'var(--text-3)' }}>
        Camera frames are processed locally by MediaPipe and never uploaded.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button className="btn-primary" onClick={onCamera}>Start with camera</button>
        <button className="btn-ghost" onClick={onPointer}>Mouse / touch only</button>
      </div>
      <Link href="/" className="inline-block mt-6 font-mono-math text-xs" style={{ color: 'var(--text-3)' }}>
        ← back to virtuo
      </Link>
    </Panel>
  );
}
