'use client';
import { useEffect } from 'react';
import { gsap, SplitText } from '@/lib/anim/gsap';

/**
 * All landing-page reveal animations in one place. Content is visible without JS;
 * GSAP only sets the start states when it runs, and nothing animates under reduced motion.
 */
export default function Choreography() {
  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const splits: SplitText[] = [];
      document.querySelectorAll<HTMLElement>('[data-reveal="split"]').forEach(el => {
        const inHero = !!el.closest('[data-scene="hero"]');
        splits.push(
          SplitText.create(el, {
            type: inHero ? 'lines,chars' : 'lines',
            mask: 'lines',
            autoSplit: true,
            onSplit: self =>
              gsap.from(inHero ? self.chars : self.lines, {
                yPercent: 110,
                duration: inHero ? 1.1 : 1.2,
                stagger: inHero ? 0.022 : 0.1,
                ease: 'expo.out',
                delay: inHero ? 0.25 : 0,
                scrollTrigger: inHero ? undefined : { trigger: el, start: 'top 85%' },
              }),
          }),
        );
      });
      gsap.utils.toArray<HTMLElement>('[data-reveal]:not([data-reveal="split"])').forEach(el => {
        const inHero = !!el.closest('[data-scene="hero"]');
        gsap.from(el, {
          autoAlpha: 0,
          y: 24,
          duration: 1,
          ease: 'power3.out',
          delay: inHero ? 0.9 : 0,
          scrollTrigger: inHero ? undefined : { trigger: el, start: 'top 88%' },
        });
      });
      return () => splits.forEach(s => s.revert());
    });
    return () => mm.revert();
  }, []);
  return null;
}
