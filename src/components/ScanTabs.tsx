import { useState } from 'react';

export type ScanTab = 'feed' | 'clean';
const KEY = 'smj-scan-tab';

/** Feeding | Cleaning tabs on QR pages. Remembers the last one, so a cleaning round stays on Cleaning. */
export function useScanTab(): [ScanTab, (t: ScanTab) => void] {
  const [tab, setTab] = useState<ScanTab>(() => {
    try {
      return localStorage.getItem(KEY) === 'clean' ? 'clean' : 'feed';
    } catch {
      return 'feed';
    }
  });
  return [
    tab,
    (t) => {
      setTab(t);
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* ignore */
      }
    },
  ];
}

export function ScanTabs({ tab, onChange }: { tab: ScanTab; onChange: (t: ScanTab) => void }) {
  return (
    <div className="segmented scan-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'feed'} className={tab === 'feed' ? 'on' : ''} onClick={() => onChange('feed')}>
        Feeding
      </button>
      <button role="tab" aria-selected={tab === 'clean'} className={tab === 'clean' ? 'on' : ''} onClick={() => onChange('clean')}>
        Cleaning
      </button>
    </div>
  );
}
