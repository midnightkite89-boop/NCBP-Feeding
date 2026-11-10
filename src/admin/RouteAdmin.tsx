import { useState } from 'react';
import { aviaryLabel, routeSort } from '../aviary';
import { useStore } from '../store';
import { supabase } from '../supabase';
import type { Bird } from '../types';

/** Put the birds in the order the feeding round walks past them. */
export function RouteAdmin() {
  const { birds, aviaries, refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ordered = routeSort(
    birds.filter((b) => b.status === 'active'),
    aviaries,
  );

  async function save(next: Bird[]) {
    setBusy(true);
    setError(null);
    // Positions go up in tens; only birds whose position changed are saved
    const changes = next.map((b, i) => ({ id: b.id, route_order: (i + 1) * 10 })).filter((c, i) => next[i].route_order !== c.route_order);
    for (const c of changes) {
      const { error } = await supabase.from('birds').update({ route_order: c.route_order }).eq('id', c.id);
      if (error) {
        setError(error.message);
        break;
      }
    }
    await refresh();
    setBusy(false);
  }

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= ordered.length) return;
    const next = ordered.slice();
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
  }

  return (
    <div>
      <h1 className="page-title">Feeding route</h1>
      <p className="muted">
        Today and Weigh list the birds in this order. Use ▲ ▼ to move a bird. Birds with no position yet go at the end, by aviary.
      </p>
      {error && <p className="warn">{error}</p>}
      <ol className="route-list">
        {ordered.map((b, i) => {
          const aviary = aviaries.find((a) => a.id === b.aviary_id);
          return (
            <li key={b.id} className={b.route_order == null ? 'unplaced' : ''}>
              <span className="route-pos">{i + 1}</span>
              <span className="route-name">
                <strong>{b.name}</strong>
                <small>{aviary ? aviaryLabel(aviary) : 'no aviary'}</small>
              </span>
              <button className="btn btn-outline" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${b.name} earlier`}>
                ▲
              </button>
              <button className="btn btn-outline" disabled={busy || i === ordered.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${b.name} later`}>
                ▼
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
