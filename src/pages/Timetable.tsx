import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { routeSort } from '../aviary';
import { I } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { FLIGHT_ORDER, todayAt } from '../flight';
import { useStore, type LogInput } from '../store';
import { supabase } from '../supabase';
import { flightTypeLabel, type Bird, type FlightType } from '../types';
import { PickChip } from './Session';

interface PlanRow {
  id: string;
  plan_date: string;
  slot_time: string;
  flight_type: FlightType;
  bird_ids: string[];
  session_id: string | null;
}

/** A slot on today's board: a saved row, or one of the usual demo times with nobody added yet */
interface Slot {
  key: string;
  time: string;
  type: FlightType;
  row: PlanRow | null;
}

/**
 * Today's demonstrations, like a whiteboard: the usual times are already there,
 * staff add the birds on the day (anyone, from any phone), and after each one the
 * handler taps Flown to log a flight for every bird in it.
 */
export function Timetable() {
  const { birds, aviaries, today, todayLogs, careSettings, logFeeds, isAdmin, refresh } = useStore();
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Slot | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('flight_plan').select('*').eq('plan_date', today).order('slot_time');
    if (error) setError("Today's timetable needs a signal to load.");
    else setError(null);
    setRows((data as PlanRow[]) ?? []);
  }, [today]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel('flight-plan')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flight_plan' }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load]);

  const slots = useMemo(() => {
    const list: Slot[] = (rows ?? []).map((r) => ({ key: r.id, time: r.slot_time, type: r.flight_type, row: r }));
    for (const t of careSettings.demo_times ?? [])
      if (!list.some((s) => s.time === t && s.type === 'display')) list.push({ key: `usual-${t}`, time: t, type: 'display', row: null });
    return list.sort((a, b) => a.time.localeCompare(b.time));
  }, [rows, careSettings.demo_times]);

  /** Logged (and not undone) = today's flights carry the slot's session id */
  const isFlown = (s: Slot) => !!s.row?.session_id && todayLogs.some((l) => l.session_id === s.row!.session_id && l.status === 'flown');

  async function saveBirds(slot: Slot, birdIds: string[]) {
    const res = slot.row
      ? await supabase.from('flight_plan').update({ bird_ids: birdIds }).eq('id', slot.row.id)
      : await supabase.from('flight_plan').insert({ plan_date: today, slot_time: slot.time, flight_type: slot.type, bird_ids: birdIds });
    if (res.error) setError("Couldn't save – no signal? Try again in a moment.");
    await load();
  }

  async function flown(slot: Slot) {
    if (!slot.row || slot.row.bird_ids.length === 0) return;
    const at = todayAt(slot.time);
    const when = at && at.getTime() < Date.now() ? at : new Date();
    const sessionId = crypto.randomUUID();
    const entries: LogInput[] = slot.row.bird_ids.map((id) => ({
      bird_id: id,
      status: 'flown',
      food_type: null,
      amount: null,
      weight_g: null,
      notes: null,
      more_due: false,
      logged_at: when.toISOString(),
      flight_type: slot.type,
      session_id: sessionId,
    }));
    // The flights go through the offline queue; the board just remembers which session they were
    logFeeds(entries, `${flightTypeLabel(slot.type)} ${slot.time} · ${entries.length} bird${entries.length === 1 ? '' : 's'} flown`, { alsoCheck: true });
    await supabase.from('flight_plan').update({ session_id: sessionId }).eq('id', slot.row.id);
    await load();
  }

  async function removeSlot(slot: Slot) {
    if (!slot.row) return;
    if (!window.confirm(`Take the ${slot.time} ${flightTypeLabel(slot.type)?.toLowerCase()} off today's board? Flights already logged stay logged.`)) return;
    await supabase.from('flight_plan').delete().eq('id', slot.row.id);
    await load();
  }

  const nameOf = (id: string) => birds.find((b) => b.id === id)?.name ?? '?';
  const earlier = (slot: Slot) => slots.filter((s) => s.row && s.row.bird_ids.length > 0 && s.key !== slot.key);

  return (
    <div className="timetable-page">
      <h1 className="page-title">Today's flying</h1>
      <p className="muted">Add the birds to each slot on the day. After it, tap Flown and a flight is logged for every bird in it.</p>
      {error && <p className="warn">{error}</p>}
      {rows == null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {slots.length === 0 && <p className="empty">Nothing on today's board yet. Add a demonstration or owl evening below.</p>}
          {slots.map((slot) => {
            const done = isFlown(slot);
            const ids = slot.row?.bird_ids ?? [];
            return (
              <article key={slot.key} className={`slot-card${done ? ' done' : ''}`}>
                <div className="slot-head">
                  <span className="slot-time">{slot.time}</span>
                  <span className="slot-type">{flightTypeLabel(slot.type)}</span>
                  {done && (
                    <span className="chip chip-fed">
                      <I n="fly" size={15} /> Flown
                    </span>
                  )}
                </div>
                {ids.length > 0 ? (
                  <div className="slot-birds">
                    {ids.map((id) => (
                      <Link key={id} to={`/bird/${id}`} className="slot-bird">
                        {nameOf(id)}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="muted slot-empty">No birds yet.</p>
                )}
                {!done && (
                  <div className="card-actions-row">
                    <button className="btn btn-outline btn-lg" onClick={() => setPicking(slot)}>
                      <I n="bird" /> {ids.length ? 'Change birds' : 'Add birds'}
                    </button>
                    {ids.length > 0 && (
                      <button className="btn btn-primary btn-lg" onClick={() => void flown(slot)}>
                        <I n="fly" /> Flown
                      </button>
                    )}
                  </div>
                )}
                {slot.row && !done && (
                  <button className="btn btn-ghost slot-remove" onClick={() => void removeSlot(slot)}>
                    Remove from today
                  </button>
                )}
              </article>
            );
          })}
          <button className="btn btn-outline btn-lg add-slot" onClick={() => setAdding(true)}>
            + Add a slot (demonstration, owl evening…)
          </button>
          {isAdmin && <DemoTimes key={(careSettings.demo_times ?? []).join()} current={careSettings.demo_times ?? []} onSaved={refresh} />}
        </>
      )}

      {picking && (
        <BirdPicker
          slot={picking}
          birds={routeSort(birds.filter((b) => b.status === 'active'), aviaries)}
          initial={picking.row?.bird_ids ?? []}
          copyFrom={earlier(picking).map((s) => ({ label: `${s.time} ${flightTypeLabel(s.type)}`, ids: s.row!.bird_ids }))}
          onClose={() => setPicking(null)}
          onSave={async (ids) => {
            await saveBirds(picking, ids);
            setPicking(null);
          }}
        />
      )}
      {adding && (
        <AddSlot
          onClose={() => setAdding(false)}
          onAdd={async (time, type) => {
            const { error } = await supabase.from('flight_plan').insert({ plan_date: today, slot_time: time, flight_type: type });
            if (error) setError(error.message.includes('duplicate') ? 'That slot is already on the board.' : "Couldn't add it – no signal?");
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Tick the birds for one slot: flying team first, then everyone else */
function BirdPicker({
  slot,
  birds,
  initial,
  copyFrom,
  onClose,
  onSave,
}: {
  slot: Slot;
  birds: Bird[];
  initial: string[];
  copyFrom: { label: string; ids: string[] }[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [search, setSearch] = useState('');
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const q = search.trim().toLowerCase();
  const shown = birds.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.species ?? '').toLowerCase().includes(q));
  const team = shown.filter((b) => b.team !== 'aviary');
  const others = shown.filter((b) => b.team === 'aviary');
  return (
    <Sheet title={`${slot.time} ${flightTypeLabel(slot.type)}: birds`} onClose={onClose}>
      {copyFrom.length > 0 && (
        <div className="chip-row">
          {copyFrom.map((c) => (
            <button key={c.label} type="button" className="btn btn-outline" onClick={() => setPicked([...new Set([...picked, ...c.ids])])}>
              + Same as {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="search session-search">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a bird" aria-label="Find a bird" autoComplete="off" />
      </div>
      <p className="session-sub">Flying team</p>
      <div className="pick-grid">
        {team.map((b) => (
          <PickChip key={b.id} bird={b} on={picked.includes(b.id)} onToggle={toggle} />
        ))}
      </div>
      {others.length > 0 && (
        <details className="slot-others" open={!!q}>
          <summary>Other birds</summary>
          <div className="pick-grid">
            {others.map((b) => (
              <PickChip key={b.id} bird={b} on={picked.includes(b.id)} onToggle={toggle} />
            ))}
          </div>
        </details>
      )}
      <button className="btn btn-primary btn-xl" onClick={() => onSave(picked)}>
        Save {picked.length ? `(${picked.length} bird${picked.length === 1 ? '' : 's'})` : ''}
      </button>
    </Sheet>
  );
}

function AddSlot({ onClose, onAdd }: { onClose: () => void; onAdd: (time: string, type: FlightType) => void }) {
  const [time, setTime] = useState('19:00');
  const [type, setType] = useState<FlightType>(FLIGHT_ORDER.includes('evening') ? 'evening' : FLIGHT_ORDER[0]);
  return (
    <Sheet title="Add a slot for today" onClose={onClose}>
      <label className="field">
        <span>Time</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <div className="field">
        <span>Type</span>
        <div className="flight-types session-types" role="radiogroup" aria-label="Type">
          {FLIGHT_ORDER.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className={`btn btn-lg flight-type${type === t ? ' on' : ''}`} onClick={() => setType(t)}>
              {flightTypeLabel(t)}
            </button>
          ))}
        </div>
      </div>
      <button className="btn btn-primary btn-xl" disabled={!/^\d\d:\d\d$/.test(time)} onClick={() => onAdd(time, type)}>
        Add to today
      </button>
    </Sheet>
  );
}

/** Admin: the demonstration times that appear on the board every day */
function DemoTimes({ current, onSaved }: { current: string[]; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(current.join(', '));
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const times = text
      .split(/[,\s]+/)
      .map((t) => t.trim().replace('.', ':'))
      .filter(Boolean)
      .map((t) => (/^\d:\d\d$/.test(t) ? `0${t}` : t));
    if (times.some((t) => !/^[0-2]\d:[0-5]\d$/.test(t))) return setMsg('Write times like 11:30, 13:30, 15:30.');
    const { error } = await supabase.from('care_settings').update({ demo_times: [...new Set(times)].sort() }).eq('id', 1);
    setMsg(error ? error.message : 'Saved.');
    await onSaved();
  }
  return (
    <section className="panel demo-times">
      <h2>Usual demonstration times</h2>
      <p className="muted">These appear on the board every day. Admin only.</p>
      <label className="field">
        <span>Times</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="11:30, 13:30, 15:30" />
      </label>
      {msg && <p className="muted">{msg}</p>}
      <button className="btn btn-outline btn-lg" onClick={() => void save()}>
        Save times
      </button>
    </section>
  );
}
