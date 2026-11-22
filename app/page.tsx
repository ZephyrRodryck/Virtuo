import Concept from '@/components/Concept';
import CTA from '@/components/CTA';
import ErrorBoundary from '@/components/ErrorBoundary';
import Gesture from '@/components/Gesture';
import Hero from '@/components/Hero';
import Instrument from '@/components/Instrument';
import Navbar from '@/components/Navbar';
import Physics from '@/components/Physics';
import Sound from '@/components/Sound';
import Choreography from '@/components/site/Choreography';
import SmoothScroll from '@/components/site/SmoothScroll';
import Stage from '@/components/site/Stage';

export default function Page() {
  return (
    <>
      <ErrorBoundary label="Stage" silent>
        <Stage />
      </ErrorBoundary>
      <SmoothScroll />
      <Choreography />
      <Navbar />
      <main className="relative" style={{ zIndex: 1 }}>
        <Hero />
        <Concept />
        <Physics />
        <Gesture />
        <Instrument />
        <Sound />
        <CTA />
      </main>
      <p data-readout="scene" aria-hidden className="hidden lg:block fixed left-8 bottom-6 z-10 font-mono-math text-[10px] tracking-wider pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </>
  );
}
