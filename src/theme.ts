import { useEffect, useState } from 'react';

// Light, dark, or follow the phone's setting. Saved on this phone only.
export type ThemeChoice = 'light' | 'dark' | 'auto';
const KEY = 'app-theme';

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'dark' || t === 'auto' ? t : 'light';
  } catch {
    return 'light';
  }
}

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Puts data-theme on <html> and colours the phone's status bar to match */
export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'auto' && prefersDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141113' : '#872250');
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* private mode: still applies until reload */
    }
    if (choice !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('auto');
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, [choice]);
  return { choice, setChoice };
}

/** Keep "Match phone" in step when the phone switches between light and dark */
export function watchPhoneTheme() {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readTheme() === 'auto') applyTheme('auto');
  });
}
