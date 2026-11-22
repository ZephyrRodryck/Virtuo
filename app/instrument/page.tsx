import type { Metadata } from 'next';
import InstrumentApp from '@/components/instrument/InstrumentApp';
import ErrorBoundary from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'VIRTUO — Instrument',
  description: 'Play VIRTUO: draw virtual strings in the air and play them with hand gestures.',
};

export default function InstrumentPage() {
  return (
    <ErrorBoundary label="The instrument">
      <InstrumentApp />
    </ErrorBoundary>
  );
}
