'use client';
import Link from 'next/link';
import { scrollToId } from '@/lib/site/scroll';

export default function Hero() {
  return (
    <section id="top" data-scene="hero" className="relative min-h-[100svh] flex flex-col justify-center px-5 sm:px-8 md:px-20 pt-28 pb-16">
      <p data-reveal className="font-mono-math text-[11px] tracking-[0.3em] mb-8" style={{ color: 'var(--accent)' }}>
        VIRTUO · GESTURE-CONTROLLED PHYSICAL INSTRUMENT
      </p>
      {/* Markup via innerHTML: SplitText rewrites these nodes, so React must not reconcile them. */}
      <h1 data-reveal="split" className="font-semibold leading-[0.92] tracking-tight" style={{ fontSize: 'clamp(2.9rem, min(9vw, 14vh), 8rem)', color: 'var(--text-1)' }}
        dangerouslySetInnerHTML={{ __html: 'Music, <br /><span class="font-light" style="color: var(--text-2)">Without Boundaries.</span>' }} />

      {/* The stage draws a real string across this line. */}
      <div data-anchor="hero-string" aria-hidden className="relative w-full h-10 my-8 md:my-10" />

      <p data-readout="hero" aria-hidden className="font-mono-math text-[11px] -mt-6 mb-8 min-h-[1em]" style={{ color: 'var(--text-3)' }} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <p data-reveal className="text-lg md:text-xl font-light max-w-md" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
          Create strings. Move your hands. Make music.
          <span className="block mt-2 font-mono-math text-xs" style={{ color: 'var(--text-3)' }}>
            Sweep your cursor or finger across the string — it obeys the wave equation.
          </span>
        </p>
        <div data-reveal className="flex flex-wrap gap-3">
          <Link href="/instrument" className="btn-primary">Enter the instrument</Link>
          <button className="btn-ghost" onClick={() => scrollToId('concept')}>How it works</button>
        </div>
      </div>
    </section>
  );
}
