import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { supabase } from '../supabase';
import type { Aviary } from '../types';
import { aviaryLabel, compareAviaries } from '../aviary';

export function AviariesAdmin() {
  const { aviaries, birds, refresh } = useStore();
  const [editing, setEditing] = useState<Partial<Aviary> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing?.name?.trim()) return;
    const row = { name: editing.name.trim(), number: editing.number ?? null, archived: editing.archived ?? false };
    const res = editing.id ? await supabase.from('aviaries').update(row).eq('id', editing.id) : await supabase.from('aviaries').insert(row);
    if (res.error) return setError(res.error.code === '23505' ? 'That section already has an aviary with that number.' : res.error.message);
    setError(null);
    setEditing(null);
    await refresh();
  }

  return (
    <div>
      <h1 className="page-title">Aviaries</h1>
      <button className="btn btn-primary btn-lg" onClick={() => setEditing({ name: '', number: null })}>
        + Add aviary
      </button>

      {editing && (
        <div className="panel">
          <label className="field">
            <span>Section (e.g. Mews)</span>
            <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          </label>
          <label className="field">
            <span>Number in that section</span>
            <input
              inputMode="numeric"
              value={editing.number ?? ''}
              onChange={(e) => setEditing({ ...editing, number: e.target.value.trim() ? Number(e.target.value) : null })}
            />
          </label>
          {editing.id && (
            <label className="check">
              <input type="checkbox" checked={!!editing.archived} onChange={(e) => setEditing({ ...editing, archived: e.target.checked })} />
              <span>Archived</span>
            </label>
          )}
          {error && <p className="warn">{error}</p>}
          <div className="bird-actions">
            <button className="btn btn-primary btn-lg" onClick={save}>
              Save
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="admin-list">
        {[...aviaries].sort(compareAviaries).map((a) => {
          const count = birds.filter((b) => b.aviary_id === a.id && b.status === 'active').length;
          return (
            <li key={a.id} className={a.archived ? 'archived' : ''}>
              <button onClick={() => setEditing(a)}>
                <span>
                  <strong>
                    {aviaryLabel(a)}
                  </strong>
                  {a.archived && ' (archived)'}
                  <br />
                  <small>
                    {count} bird{count === 1 ? '' : 's'} · code {a.slug}
                  </small>
                </span>
              </button>
              <Link to={`/a/${a.slug}`} className="btn btn-outline">
                Open
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
