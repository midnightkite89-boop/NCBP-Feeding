import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aviaryLabel, compareAviaries } from '../aviary';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { formatDay } from '../time';
import type { Aviary, BreedingKind, BreedingLog } from '../types';

const KINDS: { kind: BreedingKind; label: string; counted: boolean }[] = [
  { kind: 'nest_check', label: 'Nest check', counted: false },
  { kind: 'egg', label: 'Eggs laid', counted: true },
  { kind: 'hatched', label: 'Hatched', counted: true },
  { kind: 'fledged', label: 'Fledged', counted: true },
  { kind: 'lost', label: 'Lost', counted: true },
  { kind: 'note', label: 'Note', counted: false },
];
const kindLabel = (k: BreedingKind) => KINDS.find((x) => x.kind === k)?.label ?? k;

/**
 * Breeding aviaries and this year's season: nest checks, eggs, hatchings, fledging.
 * Admins choose which aviaries are breeding at the bottom.
 */
export function Breeding() {
  const { aviaries, birds, isAdmin, refresh, logName } = useStore();
  const [logs, setLogs] = useState<BreedingLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<{ aviary: Aviary; kind: BreedingKind } | null>(null);
  // After logging a hatching: offer to add the chicks as birds (so they count as born on the stock list)
  const [hatched, setHatched] = useState<{ aviary: Aviary; count: number; date: string } | null>(null);
  const year = new Date().getFullYear();

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('breeding_logs').select('*').is('voided_at', null).gte('log_date', `${year}-01-01`).order('logged_at');
    setError(error ? 'Breeding records need a signal to load.' : null);
    setLogs((data as BreedingLog[]) ?? []);
  }, [year]);
  useEffect(() => {
    void load();
  }, [load]);

  const breeding = useMemo(() => aviaries.filter((a) => a.breeding && !a.archived).sort(compareAviaries), [aviaries]);
  const birdsIn = (a: Aviary) => birds.filter((b) => b.status === 'active' && b.aviary_id === a.id);
  const who = (l: BreedingLog) => logName({ staff_id: l.staff_id });

  async function remove(l: BreedingLog) {
    if (!window.confirm(`Remove this ${kindLabel(l.kind).toLowerCase()} entry? It's kept on record as removed by you.`)) return;
    await supabase.rpc('void_breeding_log', { log_id: l.id });
    await load();
  }

  return (
    <div className="breeding-page">
      <h1 className="page-title">Breeding</h1>
      <p className="muted">{year} season. Log nest checks, eggs, hatchings and fledging for each breeding aviary.</p>
      {error && <p className="warn">{error}</p>}
      {breeding.length === 0 && <p className="empty">No breeding aviaries yet.{isAdmin ? ' Choose them at the bottom of this page.' : ' An admin chooses them.'}</p>}
      {breeding.map((a) => {
        const mine = (logs ?? []).filter((l) => l.aviary_id === a.id);
        const sum = (k: BreedingKind) => mine.filter((l) => l.kind === k).reduce((n, l) => n + (l.count ?? 0), 0);
        const lastCheck = mine.filter((l) => l.kind === 'nest_check').at(-1);
        return (
          <article key={a.id} className="slot-card breeding-card">
            <div className="slot-head">
              <span className="slot-time">{aviaryLabel(a)}</span>
            </div>
            <div className="slot-birds">
              {birdsIn(a).map((b) => (
                <Link key={b.id} to={`/bird/${b.id}`} className="slot-bird">
                  {b.name}
                </Link>
              ))}
            </div>
            <div className="breeding-tally">
              <span>
                <strong>{sum('egg')}</strong> eggs
              </span>
              <span>
                <strong>{sum('hatched')}</strong> hatched
              </span>
              <span>
                <strong>{sum('fledged')}</strong> fledged
              </span>
              {sum('lost') > 0 && (
                <span>
                  <strong>{sum('lost')}</strong> lost
                </span>
              )}
            </div>
            <p className="muted breeding-last">{lastCheck ? `Last nest check ${formatDay(lastCheck.log_date)}` : 'No nest checks yet this year'}</p>
            <div className="breeding-buttons">
              {KINDS.map((k) => (
                <button key={k.kind} className="btn btn-outline" onClick={() => setLogging({ aviary: a, kind: k.kind })}>
                  {k.label}
                </button>
              ))}
            </div>
            {mine.length > 0 && (
              <details className="breeding-history">
                <summary>This season ({mine.length})</summary>
                <ul>
                  {[...mine].reverse().map((l) => (
                    <li key={l.id}>
                      <strong>{formatDay(l.log_date)}</strong> · {kindLabel(l.kind)}
                      {l.count != null && ` ×${l.count}`}
                      {l.notes && ` · ${l.notes}`}
                      <span className="muted"> · {who(l)}</span>
                      <button className="btn btn-ghost breeding-remove" onClick={() => void remove(l)} aria-label="Remove entry">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        );
      })}
      {hatched && (
        <Sheet title={`${aviaryLabel(hatched.aviary)}: add the chicks`} onClose={() => setHatched(null)}>
          <p className="muted">
            Adding each chick as a bird puts it on the round and counts it as born on the stock list. You can give it a name and sex later.
          </p>
          <div className="more-list">
            {Array.from({ length: hatched.count }, (_, i) => {
              const species = birdsIn(hatched.aviary)[0]?.species ?? '';
              const q = new URLSearchParams({ born: hatched.date, aviary: hatched.aviary.id, species, name: `${species || 'Chick'} chick ${hatched.date.slice(0, 4)} ${i + 1}` });
              return (
                <Link key={i} to={`/admin/birds/new?${q}`}>
                  + Add chick {i + 1}
                </Link>
              );
            })}
          </div>
          <button className="btn btn-outline btn-lg" onClick={() => setHatched(null)}>
            Not now
          </button>
        </Sheet>
      )}
      {isAdmin && <ChooseBreeding aviaries={aviaries} onSaved={refresh} />}
      {logging && (
        <LogSheet
          aviary={logging.aviary}
          kind={logging.kind}
          onClose={() => setLogging(null)}
          onSaved={async (count) => {
            if (logging.kind === 'hatched' && isAdmin) setHatched({ aviary: logging.aviary, count, date: new Date().toISOString().slice(0, 10) });
            setLogging(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function LogSheet({ aviary, kind, onClose, onSaved }: { aviary: Aviary; kind: BreedingKind; onClose: () => void; onSaved: (count: number) => void }) {
  const k = KINDS.find((x) => x.kind === kind)!;
  const [count, setCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (kind === 'note' && !notes.trim()) return setError('Write the note first.');
    setBusy(true);
    const { error } = await supabase.from('breeding_logs').insert({ aviary_id: aviary.id, kind, count: k.counted ? count : null, notes: notes.trim() || null });
    setBusy(false);
    if (error) return setError("Couldn't save – no signal? Try again in a moment.");
    onSaved(count);
  }
  return (
    <Sheet title={`${aviaryLabel(aviary)}: ${k.label.toLowerCase()}`} onClose={onClose}>
      {k.counted && (
        <div className="field">
          <span>How many</span>
          <div className="stepper">
            <button type="button" onClick={() => setCount(Math.max(1, count - 1))} disabled={count <= 1} aria-label="One fewer">
              −
            </button>
            <output>{count}</output>
            <button type="button" onClick={() => setCount(Math.min(30, count + 1))} aria-label="One more">
              +
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={kind === 'nest_check' ? 'e.g. sitting tight, 2 eggs seen' : 'Optional'} />
      </label>
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Sheet>
  );
}

/** Admin: tick the aviaries that are breeding */
function ChooseBreeding({ aviaries, onSaved }: { aviaries: Aviary[]; onSaved: () => Promise<void> }) {
  const { birds } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  // Aviaries with aviary (non-flying) birds in them, by section
  const list = aviaries
    .filter((a) => !a.archived && birds.some((b) => b.status === 'active' && b.aviary_id === a.id && b.team === 'aviary'))
    .sort(compareAviaries);
  return (
    <section className="panel">
      <h2>Which aviaries are breeding?</h2>
      <p className="muted">Admin only. Ticked aviaries appear above.</p>
      <div className="breeding-choose">
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`pick-chip${a.breeding ? ' on' : ''}`}
            aria-pressed={!!a.breeding}
            disabled={busy === a.id}
            onClick={async () => {
              setBusy(a.id);
              await supabase.from('aviaries').update({ breeding: !a.breeding }).eq('id', a.id);
              await onSaved();
              setBusy(null);
            }}
          >
            {a.breeding ? '✓ ' : ''}
            {aviaryLabel(a)}
          </button>
        ))}
      </div>
    </section>
  );
}
