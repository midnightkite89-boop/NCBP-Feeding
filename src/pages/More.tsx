import { Link } from 'react-router-dom';
import { has } from '../centre';
import { roundNames } from '../types';
import { useStore } from '../store';
import { supabase } from '../supabase';

/** The More tab: feeding round for everyone, admin pages grouped for the admin, sign out. */
export function More() {
  const { me, isAdmin, pendingCount, careSettings } = useStore();

  async function signOut() {
    if (pendingCount > 0 && !window.confirm(`${pendingCount} change(s) haven't been sent yet and will be lost if you sign out. Sign out anyway?`)) return;
    localStorage.removeItem('smj-snapshot');
    localStorage.removeItem('smj-queue');
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <div className="more-page">
      <h1 className="page-title">More</h1>
      <p className="muted">
        Signed in as <strong>{me?.display_name ?? '…'}</strong>
        {isAdmin && ' · admin'}
      </p>

      <Group title="Round">
        {roundNames(careSettings).length > 1 ? (
          roundNames(careSettings).map((n, i) => <Item key={n} to={`/round?r=${i + 1}`} icon="🧭" label={`Start ${n.toLowerCase()}`} />)
        ) : (
          <Item to="/round" icon="🧭" label="Start feeding round" />
        )}
        {has('sessions') && <Item to="/session" icon="✈" label="Log a session (experience, display…)" />}
        {has('gpsFlights') && <Item to="/flights" icon="📍" label="Today's flights and GPS logs" />}
        {has('outings') && <Item to="/outings" icon="🚐" label="Outings: shows, schools, parties" />}
      </Group>

      {has('leftovers') && (
        <Group title="Records">
          <Item to="/feed-sheet" icon="📋" label="Feed sheets (fed and left, by barn)" />
        </Group>
      )}

      <Group title="Health">
        <Item to="/health" icon="🩺" label="Health issues and medication" />
      </Group>

      {has('aalForms') && (
        <Group title="Contacts">
          <Item to="/aal/r4" icon="📞" label="Vet contact details" />
        </Group>
      )}

      {isAdmin && (
        <>
          <Group title="Birds and aviaries">
            <Item to="/admin/birds" icon="🪶" label="Birds" />
            <Item to="/admin/aviaries" icon="🏠" label="Aviaries" />
            <Item to="/admin/route" icon="🗺" label="Feeding route" />
            <Item to="/admin/import" icon="⬆" label="Import birds (CSV)" />
          </Group>
          {has('aalForms') && (
            <Group title="Records">
              <Item to="/aal" icon="📋" label="AAL records (R1–R8)" />
            </Group>
          )}
          <Group title="Print and export">
            <Item to="/admin/qr" icon="▦" label="QR labels" />
            <Item to="/weigh/week" icon="📅" label="Weekly chart" />
          </Group>
          <Group title="Settings">
            <Item to="/admin/care" icon="⚙" label="Cleaning, winter and frost" />
            {has('ferrets') && <Item to="/ferrets" icon="🐾" label="Ferret food list and cages" />}
            <Item to="/admin/staff" icon="👥" label="Staff" />
            {has('driveSync') && <Item to="/admin/drive" icon="📁" label="Google Drive copying" />}
          </Group>
        </>
      )}

      <button className="btn btn-outline btn-lg sign-out" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="more-group">
      <h2>{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function Item({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <li>
      <Link to={to}>
        <span className="more-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
        <span className="more-chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
