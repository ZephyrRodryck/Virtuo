'use client';
import { Component, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
  /** Render nothing on failure (for decorative layers) instead of an error message. */
  silent?: boolean;
}

export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
        <div className="max-w-md p-8" style={{ border: '1px solid var(--border)' }}>
          <p className="font-mono-math text-xs tracking-[0.25em] mb-4" style={{ color: 'var(--accent-warm)' }}>ERROR</p>
          <p style={{ color: 'var(--text-1)' }}>{this.props.label} stopped unexpectedly.</p>
          <p className="mt-2 text-sm font-mono-math" style={{ color: 'var(--text-3)' }}>{this.state.error.message}</p>
          <button className="btn-ghost mt-6" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
