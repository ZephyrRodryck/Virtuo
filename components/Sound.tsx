'use client';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { site, stageNow } from '@/lib/site/store';

const CHAIN = [
  { k: '01', t: 'Two travelling waves', d: 'Each string is two delay lines: R moves toward the bridge, L toward the nut. Their sum is the displacement — d’Alembert’s solution of the wave equation.' },
  { k: '02', t: 'Reflection and loss', d: 'Both ends invert the wave. At the bridge a one-pole filter H(z) removes a little energy, more at high frequencies, so the tone darkens as it decays.' },
  { k: '03', t: 'Tuning', d: 'The round trip takes exactly sampleRate / f₀ samples, with fractional delay for pitches between samples. Slides and bends glide the delay length.' },
  { k: '04', t: 'AudioWorklet', d: 'Every string is a voice in one AudioWorklet, rendered in 128-sample blocks on the audio thread. The same delay lines are sampled to draw the strings.' },
];

export default function Sound() {
  const listen = async () => {
    site.waveguide.excitedAt = stageNow();
    if (!(await audioEngine.start())) return;
    audioEngine.configure('waveguide-demo', { freq: 110, t60: 3, brightness: 0.55, pan: 0.15, muted: false, immediate: true });
    audioEngine.pluck('waveguide-demo', 0.25, 0.8);
  };

  return (
    <section id="sound" data-scene="sound" className="relative min-h-[100svh] px-5 sm:px-8 md:px-20 py-28 flex flex-col justify-center">
      <p data-reveal className="font-mono-math text-[11px] tracking-[0.3em] mb-4" style={{ color: 'var(--accent)' }}>06 / SOUND ARCHITECTURE</p>
      <h2 data-reveal="split" className="font-semibold leading-tight max-w-3xl" style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'var(--text-1)' }} dangerouslySetInnerHTML={{ __html: 'The waveform is the string.' }} />

      <div className="mt-14 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12">
        <div>
          <div data-anchor="sound-box" className="relative w-full h-[min(58vh,480px)]" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
          <div className="mt-6 flex items-end gap-6">
            <div className="flex-1">
              <p className="font-mono-math text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>|DFT| OF out[n] AT HARMONICS k·f₀</p>
              <div data-bars="spectrum" className="flex items-end gap-2 h-14" aria-hidden>
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className="flex-1 h-full origin-bottom" style={{ background: 'var(--accent)', opacity: 0.4 + 0.07 * (8 - i), transform: 'scaleY(0.02)' }} />
                ))}
              </div>
            </div>
            <button className="btn-ghost shrink-0" onClick={listen}>Excite &amp; listen</button>
          </div>
        </div>

        <ol className="space-y-6">
          {CHAIN.map(c => (
            <li key={c.k} data-reveal className="pl-5" style={{ borderLeft: '1px solid var(--border)' }}>
              <p className="font-mono-math text-[11px]" style={{ color: 'var(--text-3)' }}>{c.k}</p>
              <h3 className="mt-1 font-semibold" style={{ color: 'var(--text-1)' }}>{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{c.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
