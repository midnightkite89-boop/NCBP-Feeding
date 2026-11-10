import { I, type IconName } from './Icon';
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { has } from '../centre';
import { useStore } from '../store';
import { useCleaning } from '../useCleaning';
import { ActingBar } from './ActingBar';

const UNDO_MS = 10_000;

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Today', icon: 'food', end: true },
  { to: '/weigh', label: 'Weigh', icon: 'weigh' },
  { to: '/clean', label: 'Clean', icon: 'clean' },
  ...(has('ferrets') ? [{ to: '/ferrets', label: 'Ferrets', icon: 'ferret' as const }] : []),
  { to: '/more', label: 'More', icon: 'more' },
];

export function Layout() {
  const { online, pendingCount, syncError, dismissSyncError, undo, undoLast, dismissUndo } = useStore();
  const { pathname } = useLocation();
  const { alertCount, alerts } = useCleaning();
  // Round mode is full screen: no tab bar
  const fullScreen = pathname.startsWith('/round');

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(dismissUndo, Math.max(0, UNDO_MS - (Date.now() - undo.at)));
    return () => window.clearTimeout(t);
  }, [undo, dismissUndo]);

  // Admin pages and QR pages count as "More" / "Today" for the highlighted tab
  const moreActive = pathname.startsWith('/more') || pathname.startsWith('/admin');

  return (
    <>
      <div className="top-safe" />
      {!online && (
        <div className="banner banner-offline">
          No signal – you can keep logging.{pendingCount > 0 && ` ${pendingCount} change(s) will send automatically.`}
        </div>
      )}
      {online && pendingCount > 0 && <div className="banner banner-sync">Waiting to send {pendingCount} change(s)… they are saved on this phone.</div>}
      {syncError && (
        <div className="banner banner-error" onClick={dismissSyncError}>
          {syncError} (tap to dismiss)
        </div>
      )}

      <ActingBar />
      <main className={fullScreen ? 'full-screen' : ''}>
        <Outlet />
      </main>

      {undo && (
        <div className={`undo-bar${fullScreen ? ' no-tabs' : ''}`} role="status">
          <span>✓ {undo.label}</span>
          <button className="btn btn-undo" onClick={undoLast}>
            UNDO
          </button>
        </div>
      )}

      {!fullScreen && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => (isActive || (t.to === '/more' && moreActive) ? 'active' : '')}
            >
              <span className="tab-icon" aria-hidden="true">
                <I n={t.icon} size={24} />
              </span>
              {t.to === '/clean' && alertCount > 0 && (
                <span className="tab-badge" aria-label={alerts.join(', ')}>
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
              <span className="tab-label">{t.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}
