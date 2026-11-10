import { useState } from 'react';
import { useStore } from '../store';
import { supabase } from '../supabase';
import type { Profile, Role } from '../types';

export function StaffAdmin() {
  const { profiles, me, refresh } = useStore();
  const [error, setError] = useState<string | null>(null);

  async function update(p: Profile, changes: Partial<Pick<Profile, 'display_name' | 'role' | 'shared_device'>>) {
    if (p.id === me?.id && changes.role === 'staff' && !window.confirm('Remove your own admin access? You would need Supabase to get it back.')) return;
    const { error } = await supabase.from('profiles').update(changes).eq('id', p.id);
    setError(error?.message ?? null);
    await refresh();
  }

  return (
    <div>
      <h1 className="page-title">Staff</h1>
      <p className="muted">
        To add someone: Supabase → Authentication → Users → Add user. They appear here straight away; set their name below.
      </p>
      <p className="muted">
        <strong>Shared device</strong>: tick for a login several people use, like the shed iPad. It then asks who's using it, and logs are saved as e.g. "Gill (Shed iPad)".
      </p>
      {error && <p className="warn">{error}</p>}
      <ul className="admin-list">
        {profiles.map((p) => (
          <li key={p.id} className="staff-row">
            <input
              defaultValue={p.display_name}
              aria-label="Display name"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.display_name && update(p, { display_name: e.target.value.trim() })}
            />
            <select value={p.role} onChange={(e) => update(p, { role: e.target.value as Role })} aria-label="Role">
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
            <label className="check shared-check">
              <input type="checkbox" checked={!!p.shared_device} onChange={(e) => update(p, { shared_device: e.target.checked })} />
              <span>Shared device</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
