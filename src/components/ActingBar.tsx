import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Sheet } from './Sheet';

const VOLUNTEERS_KEY = 'smj-volunteers';

/** Volunteer first names used on this device, most recent first */
function recentVolunteers(): string[] {
  try {
    return JSON.parse(localStorage.getItem(VOLUNTEERS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function rememberVolunteer(name: string) {
  const next = [name, ...recentVolunteers().filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 12);
  try {
    localStorage.setItem(VOLUNTEERS_KEY, JSON.stringify(next));
  } catch {
    // not saved; it only affects the quick-pick list
  }
}

/**
 * Shared devices only (e.g. the shed iPad): "Logging as: Gill ▾".
 * Pick your name once (staff, or a volunteer's first name); it sticks until
 * 2 hours without use, or tomorrow.
 */
export function ActingBar() {
  const { me, profiles, acting, setActingFor, staffName } = useStore();
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [volunteer, setVolunteer] = useState('');
  const [, tick] = useState(0);

  // Re-check every minute so the name drops off after 2 idle hours
  useEffect(() => {
    if (!me?.shared_device) return;
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [me?.shared_device]);

  if (!me?.shared_device) return null;
  const people = profiles.filter((p) => !p.shared_device).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const recent = recentVolunteers();
  const label = acting?.id ? staffName(acting.id) : acting?.name ? `${acting.name} (volunteer)` : null;

  function close() {
    setPicking(false);
    setTyping(false);
    setVolunteer('');
  }

  function pickVolunteer(name: string) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) return;
    rememberVolunteer(clean);
    setActingFor({ id: null, name: clean });
    close();
  }

  return (
    <>
      <button type="button" className={`acting-bar${label ? '' : ' nobody'}`} onClick={() => setPicking(true)}>
        {label ? (
          <>
            Logging as <strong>{label}</strong> <span aria-hidden="true">▾</span> <span className="acting-change">change</span>
          </>
        ) : (
          <>
            <strong>Who's using the {me.display_name}?</strong> Tap to pick your name
          </>
        )}
      </button>
      {picking && (
        <Sheet title="Who's using it?" onClose={close}>
          <p className="muted">Everything you log is saved under your name. It stays until the {me.display_name} has been left for 2 hours, or until tomorrow.</p>
          <p className="session-sub">Staff</p>
          <div className="pick-grid acting-grid">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pick-chip${acting?.id === p.id ? ' on' : ''}`}
                aria-pressed={acting?.id === p.id}
                onClick={() => {
                  setActingFor({ id: p.id, name: null });
                  close();
                }}
              >
                {p.display_name}
              </button>
            ))}
          </div>

          <p className="session-sub">Volunteers</p>
          <div className="pick-grid acting-grid">
            {recent.map((n) => (
              <button
                key={n}
                type="button"
                className={`pick-chip volunteer${acting?.name === n ? ' on' : ''}`}
                aria-pressed={acting?.name === n}
                onClick={() => pickVolunteer(n)}
              >
                {n}
              </button>
            ))}
            {!typing && (
              <button type="button" className="pick-chip volunteer" onClick={() => setTyping(true)}>
                + Volunteer
              </button>
            )}
          </div>
          {typing && (
            <form
              className="volunteer-form"
              onSubmit={(e) => {
                e.preventDefault();
                pickVolunteer(volunteer);
              }}
            >
              <label className="field">
                <span>Volunteer's first name</span>
                <input id="volunteer-name" value={volunteer} onChange={(e) => setVolunteer(e.target.value)} autoComplete="off" autoCapitalize="words" autoFocus />
              </label>
              <button type="submit" className="btn btn-primary btn-lg" disabled={!volunteer.trim()}>
                Use this name
              </button>
            </form>
          )}

          {acting && (
            <button
              type="button"
              className="btn btn-outline btn-lg acting-clear"
              onClick={() => {
                setActingFor(null);
                close();
              }}
            >
              I've finished – clear my name
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}
