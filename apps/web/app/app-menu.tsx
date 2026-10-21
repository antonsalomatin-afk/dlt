'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A disclosure leaves the learning screen mounted, including its pending choice. */
export function AppMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    navigation.current?.querySelector('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return <div className="app-menu">
    <button ref={trigger} className="menu-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Menu <span aria-hidden="true">{open ? '×' : '☰'}</span></button>
    {open && <nav ref={navigation} id={id} aria-label="Learning menu" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) setOpen(false);
    }}>{children}</nav>}
  </div>;
}
