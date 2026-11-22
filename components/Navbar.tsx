'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audioEngine, type AudioStatus } from '@/lib/audio/AudioEngine';
import { scrollToId } from '@/lib/site/scroll';
import { site } from '@/lib/site/store';

const LINKS = [
  { id: 'concept', label: 'Concept' },
  { id: 'physics', label: 'Physics' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'sound', label: 'Sound' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('');
  const [soundOn, setSoundOn] = useState(false);
  const audio = useSyncExternalStore(audioEngine.subscribe.bind(audioEngine), (): AudioStatus => audioEngine.status, (): AudioStatus => 'off');
  const menuRef = useRef<HTMLDivElement>(null);

  // Highlight the section whose area covers the middle of the viewport.
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => entries.forEach(e => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-50% 0px -50% 0px' },
    );
    document.querySelectorAll('section[id]').forEach(s => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    menuRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  const go = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setOpen(false);
    scrollToId(id);
  };

  const toggleSound = async () => {
    if (soundOn) {
      site.sound = false;
      setSoundOn(false);
      return;
    }
    if (await audioEngine.start()) {
      site.sound = true;
      setSoundOn(true);
    }
  };

  const soundLabel = audio === 'error' || audio === 'unsupported' ? 'sound unavailable' : soundOn ? 'sound on' : 'sound off';

  return (
    <header className="fixed top-0 inset-x-0 z-50" style={{ background: 'linear-gradient(to bottom, rgba(4,4,10,0.96) 55%, rgba(4,4,10,0))' }}>
      <nav className="flex items-center justify-between px-5 sm:px-8 md:px-20 py-5" aria-label="Main">
        <a href="#top" onClick={e => go(e, 'top')} className="flex items-center gap-3" aria-label="VIRTUO — back to top">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
            <path d="M1 11h20" stroke="var(--accent)" strokeWidth="1.2" />
            <path d="M1 11 Q6 4 11 11 T21 11" stroke="var(--text-2)" strokeWidth="1" />
            <circle cx="1.5" cy="11" r="1.5" fill="var(--accent)" />
            <circle cx="20.5" cy="11" r="1.5" fill="var(--accent)" />
          </svg>
          <span className="font-semibold text-sm tracking-[0.25em]" style={{ color: 'var(--text-1)' }}>VIRTUO</span>
        </a>

        <ul className="hidden md:flex items-center gap-8">
          {LINKS.map(l => (
            <li key={l.id}>
              <a href={`#${l.id}`} onClick={e => go(e, l.id)} aria-current={active === l.id ? 'true' : undefined}
                className="font-mono-math text-[11px] tracking-[0.18em] uppercase transition-colors hover:text-[var(--text-1)]"
                style={{ color: active === l.id ? 'var(--text-1)' : 'var(--text-3)' }}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <button onClick={toggleSound} aria-pressed={soundOn} disabled={audio === 'unsupported'}
            className="hidden sm:inline-flex items-center gap-2 font-mono-math text-[11px] tracking-[0.18em] uppercase px-3 py-2"
            style={{ color: soundOn ? 'var(--accent)' : 'var(--text-3)', border: '1px solid var(--border)' }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: soundOn ? 'var(--accent)' : 'var(--text-3)' }} />
            {soundLabel}
          </button>
          <Link href="/instrument" className="hidden md:inline-block font-mono-math text-[11px] tracking-[0.18em] uppercase px-4 py-2"
            style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            Enter
          </Link>
          <button className="md:hidden p-2 -mr-2" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="mobile-menu">
            <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden><path d="M0 1h22M0 7h22M0 13h14" stroke="var(--text-1)" strokeWidth="1.2" /></svg>
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col px-6 py-5" style={{ background: 'var(--bg)' }}>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm tracking-[0.25em]" style={{ color: 'var(--text-1)' }}>VIRTUO</span>
            <button className="p-2 -mr-2 font-mono-math text-xs tracking-widest" onClick={() => setOpen(false)} style={{ color: 'var(--text-2)' }}>CLOSE</button>
          </div>
          <ul className="mt-14 space-y-1">
            {LINKS.map((l, i) => (
              <li key={l.id}>
                <a href={`#${l.id}`} onClick={e => go(e, l.id)} className="flex items-baseline gap-4 py-3 text-3xl font-light"
                  style={{ color: active === l.id ? 'var(--text-1)' : 'var(--text-2)', borderBottom: '1px solid var(--border)' }}>
                  <span className="font-mono-math text-xs" style={{ color: 'var(--accent)' }}>0{i + 2}</span>{l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-3">
            <button className="btn-ghost" onClick={toggleSound} aria-pressed={soundOn}>{soundLabel}</button>
            <Link href="/instrument" className="btn-primary text-center">Enter the instrument</Link>
          </div>
        </div>
      )}
    </header>
  );
}
