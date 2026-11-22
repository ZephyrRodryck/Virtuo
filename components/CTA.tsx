'use client';
import Link from 'next/link';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { site, stageNow } from '@/lib/site/store';

export default function CTA() {
  const listen = async () => {
    if (await audioEngine.start()) site.sound = true;
    site.cta.arpeggioAt = stageNow();
  };

  return (
    <section id="enter" data-scene="cta" className="relative min-h-[100svh] px-5 flex flex-col items-center justify-center text-center py-28">
      <div data-anchor="cta-ring" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(86vw,78vh)] aspect-square pointer-events-none" aria-hidden />
      <p data-reveal className="relative font-mono-math text-[11px] tracking-[0.3em] mb-8" style={{ color: 'var(--accent)' }}>07 / ENTER VIRTUO</p>
      <h2 data-reveal="split" className="relative font-semibold leading-[0.95]" style={{ fontSize: 'clamp(2.6rem, 8vw, 6.5rem)', color: 'var(--text-1)' }}
        dangerouslySetInnerHTML={{ __html: 'Your hands <br /><span class="font-light" style="color: var(--text-2)">are the instrument.</span>' }} />
      <p data-reveal className="relative mt-8 max-w-md" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
        A webcam and a browser. Tracking runs on your device; nothing is uploaded.
      </p>
      <div data-reveal className="relative mt-10 flex flex-wrap justify-center gap-3">
        <Link href="/instrument" className="btn-primary">Enter the instrument</Link>
        <button className="btn-ghost" onClick={listen}>Listen to the ring</button>
      </div>
      <p className="relative mt-16 font-mono-math text-[11px]" style={{ color: 'var(--text-3)' }}>
        MediaPipe hand tracking · digital waveguide synthesis · Web Audio AudioWorklet
      </p>
    </section>
  );
}
