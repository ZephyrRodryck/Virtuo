'use client';
import { useEffect, useRef, useState } from 'react';
import { ScrollTrigger } from '@/lib/anim/gsap';
import { GESTURES } from '@/lib/site/scenes';
import { site } from '@/lib/site/store';

const INFO: Record<(typeof GESTURES)[number], string> = {
  pinch: 'Thumb meets index. Below the calibrated ratio it anchors a string endpoint; pull to draw.',
  pluck: 'A fingertip path that crosses the string excites it where it crossed, harder the faster you move.',
  slide: 'Pinch on a string to stop it. Sliding shortens the vibrating length, so pitch rises continuously.',
  strum: 'One sweep across several strings plucks each one in the order it was crossed.',
  bend: 'Pull a stopped string sideways. It stretches, tension rises, and so does the pitch.',
  tremolo: 'Rub quickly back and forth over one string: alternating crossings re-excite it.',
  mute: 'An open palm over a string raises its damping until the vibration dies.',
};

export default function Gesture() {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top top',
      end: () => `+=${window.innerHeight * 4.2}`,
      pin: true,
      onUpdate: self => {
        site.gesture.progress = self.progress;
        setStep(Math.min(GESTURES.length - 1, Math.floor(self.progress * GESTURES.length * 0.999)));
      },
    });
    return () => st.kill();
  }, []);

  return (
    <section ref={ref} id="gestures" data-scene="gesture" className="relative h-[100svh] px-5 sm:px-8 md:px-20 pt-24 pb-8 flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono-math text-[11px] tracking-[0.3em] mb-3" style={{ color: 'var(--accent)' }}>04 / GESTURE INTERACTION</p>
          <h2 className="font-semibold leading-tight" style={{ fontSize: 'clamp(1.8rem, 4.2vw, 3.4rem)', color: 'var(--text-1)' }}>
            Seven gestures. One physical string.
          </h2>
        </div>
        <p className="font-mono-math text-sm shrink-0" style={{ color: 'var(--text-3)' }}>0{step + 1} / 07</p>
      </div>

      <div className="mt-6 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6 lg:gap-12">
        <div className="order-2 lg:order-1 flex flex-col lg:justify-center">
        <ol className="flex lg:flex-col flex-wrap gap-x-4 gap-y-1 lg:gap-0" aria-label="Gestures">
          {GESTURES.map((g, i) => (
            <li key={g} aria-current={i === step ? 'step' : undefined} className="lg:py-3 transition-colors duration-300" style={{ borderTop: '1px solid transparent' }}>
              <span className="font-mono-math text-xs lg:text-sm uppercase tracking-widest" style={{ color: i === step ? 'var(--text-1)' : 'var(--text-3)' }}>
                <span style={{ color: i === step ? 'var(--accent)' : 'var(--text-3)' }}>0{i + 1}</span> {g}
              </span>
              {i === step && (
                <p className="hidden lg:block mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{INFO[g]}</p>
              )}
            </li>
          ))}
        </ol>
        <p className="lg:hidden mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{INFO[GESTURES[step]]}</p>
        </div>
        <div data-anchor="gesture-box" className="relative order-1 lg:order-2 min-h-[38svh]" style={{ border: '1px solid var(--border)' }} />
      </div>
    </section>
  );
}
