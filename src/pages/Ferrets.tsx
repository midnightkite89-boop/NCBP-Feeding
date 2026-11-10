import { useEffect, useState } from 'react';
import { CLEAN_LABEL, agoText, daysBetween, type CleanState } from '../care';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { addDays, formatDay, formatTime } from '../time';
import { DEFAULT_FERRET_FOODS, type Ferret, type FerretCage, type FerretLog } from '../types';

const CLEAN_TASKS = [
  { value: 'spot', label: 'Spot clean' },
  { value: 'full', label: 'Full clean' },
];

/** Ferrets: one card per cage (Boys, Girls) for feeding and cleaning, plus weighing each ferret. */
export function Ferrets() {
  const { ferretCages, ferretLogs, today, isAdmin, loading } = useStore();
  const [tab, setTab] = useState<'care' | 'weigh'>(() => {
    try {
      return localStorage.getItem('smj-ferret-tab') === 'weigh' ? 'weigh' : 'care';
    } catch {
      return 'care';
    }
  });
  const pick = (t: 'care' | 'weigh') => {
    setTab(t);
    try {
      localStorage.setItem('smj-ferret-tab', t);
    } catch {
      // not saved; fine
    }
  };
  if (loading) return <p className="empty">Loading…</p>;
  const notFed = ferretCages.filter((c) => !ferretLogs.some((l) => l.cage_id === c.id && l.kind === 'feed' && l.log_date === today)).length;

  const tabs = (
    <div className="segmented" role="tablist">
      <button role="tab" aria-selected={tab === 'care'} className={tab === 'care' ? 'on' : ''} onClick={() => pick('care')}>
        Feed &amp; clean
      </button>
      <button role="tab" aria-selected={tab === 'weigh'} className={tab === 'weigh' ? 'on' : ''} onClick={() => pick('weigh')}>
        ⚖ Weigh
      </button>
    </div>
  );
  if (tab === 'weigh')
    return (
      <div className="ferrets-page">
        {tabs}
        <FerretWeigh />
        {isAdmin && <FerretAdmin />}
      </div>
    );

  return (
    <div className="ferrets-page">
      {tabs}
      <section className={`counter ${notFed === 0 ? 'counter-done' : 'counter-todo'}`}>
        <div className="counter-date">{formatDay(today)}</div>
        <div className="counter-big">{notFed === 0 ? '✓ Ferrets all fed' : `${notFed} cage${notFed === 1 ? '' : 's'} still to feed`}</div>
      </section>
      {ferretCages.length === 0 && <p className="empty">No ferret cages set up yet.</p>}
      {ferretCages.map((c) => (
        <FerretCard key={c.id} cage={c} />
      ))}
      {isAdmin && <FerretAdmin />}
    </div>
  );
}

function FerretCard({ cage }: { cage: FerretCage }) {
  const { ferretLogs, today, logName, careSettings } = useStore();
  const [sheet, setSheet] = useState<'feed' | 'clean' | null>(null);
  const logs = ferretLogs.filter((l) => l.cage_id === cage.id);
  const fedToday = logs.filter((l) => l.kind === 'feed' && l.log_date === today);
  const cleans = logs.filter((l) => l.kind === 'clean');
  // A full clean counts as today's spot clean too
  const spotToday = cleans.filter((l) => l.log_date === today).at(-1) ?? null;
  const lastFull = cleans.filter((l) => l.tasks.includes('full')).at(-1) ?? null;
  const fullDays = lastFull ? daysBetween(lastFull.log_date, today) : null;
  const fullState: CleanState =
    fullDays == null ? 'never' : fullDays >= careSettings.clean_overdue_days ? 'overdue' : fullDays >= careSettings.clean_due_days ? 'due' : 'ok';

  return (
    <article className={`bird-card ferret-card state-${fedToday.length ? 'fed' : 'todo'}`}>
      <div className="bird-head">
        <div className="bird-title">
          <div className="bird-name">{cage.name}</div>
          <div className="species">
            {cage.ferrets} ferret{cage.ferrets === 1 ? '' : 's'}
            {cage.names && ` · ${cage.names}`}
          </div>
        </div>
        <div className={`chip chip-${fedToday.length ? 'fed' : 'todo'}`}>{fedToday.length ? '✓ Fed' : '! To feed'}</div>
      </div>

      <h3 className="ferret-sub">Feeding</h3>
      {fedToday.length > 0 ? (
        fedToday.map((l) => <LogLine key={l.id} log={l} text={`Fed ${formatTime(l.logged_at)} by ${logName(l)}${l.food ? ` – ${l.food}` : ''}`} />)
      ) : (
        <p className="last-log">Not fed today</p>
      )}
      <button className={`btn btn-xl ${fedToday.length ? 'btn-outline' : 'btn-feed'}`} onClick={() => setSheet('feed')}>
        <span className="btn-main">{fedToday.length ? 'Fed again' : 'FED'}</span>
      </button>

      <h3 className="ferret-sub">Cleaning</h3>
      <div className="ferret-clean">
        <div className={`clean-row ${spotToday ? 'clean-ok' : 'clean-overdue'}`}>
          <div className="clean-info">
            <strong>Spot clean</strong>
            <div className="clean-last">
              {spotToday ? `Done today ${formatTime(spotToday.logged_at)} by ${logName(spotToday)}` : 'Not done today'}
            </div>
          </div>
          <span className={`chip clean-chip-${spotToday ? 'ok' : 'overdue'}`}>{spotToday ? '✓ Done' : 'To do'}</span>
        </div>
        <div className={`clean-row clean-${fullState}`}>
          <div className="clean-info">
            <strong>Full clean</strong>
            <div className="clean-last">{lastFull ? `${agoText(fullDays)[0].toUpperCase()}${agoText(fullDays).slice(1)} by ${logName(lastFull)}` : 'No full clean logged yet'}</div>
          </div>
          <span className={`chip clean-chip-${fullState}`}>{CLEAN_LABEL[fullState]}</span>
        </div>
      </div>
      <button className="btn btn-outline btn-lg ferret-clean-btn" onClick={() => setSheet('clean')}>
        Cleaned
      </button>

      {sheet === 'feed' && <FeedSheet cage={cage} onClose={() => setSheet(null)} />}
      {sheet === 'clean' && <CleanSheet cage={cage} onClose={() => setSheet(null)} />}
    </article>
  );
}

function LogLine({ log, text }: { log: FerretLog; text: string }) {
  return (
    <p className="last-log">
      {text}
      {log.notes && <em> – {log.notes}</em>}
      {log.pending && <span className="pending"> · not sent yet</span>}
    </p>
  );
}

function FeedSheet({ cage, onClose }: { cage: FerretCage; onClose: () => void }) {
  const { careSettings, ferretLogs, logFerret } = useStore();
  const foods = careSettings.ferret_foods?.length ? careSettings.ferret_foods : DEFAULT_FERRET_FOODS;
  // Start on whatever this cage was last fed
  const lastFood = ferretLogs.filter((l) => l.cage_id === cage.id && l.kind === 'feed').at(-1)?.food ?? foods[0];
  const [food, setFood] = useState(lastFood ?? '');
  const [other, setOther] = useState(!!lastFood && !foods.includes(lastFood));
  const [notes, setNotes] = useState('');

  return (
    <Sheet title={`Fed – ${cage.name}`} onClose={onClose}>
      <div className="field">
        <span>Food</span>
        <div className="food-grid" role="radiogroup" aria-label="Food">
          {foods.map((f) => (
            <button
              type="button"
              key={f}
              role="radio"
              aria-checked={!other && food === f}
              className={!other && food === f ? 'on' : ''}
              onClick={() => {
                setOther(false);
                setFood(f);
              }}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={other}
            className={other ? 'on' : ''}
            onClick={() => {
              setOther(true);
              setFood('');
            }}
          >
            Other
          </button>
        </div>
        {other && <input className="food-other" value={food} onChange={(e) => setFood(e.target.value)} placeholder="Type the food" autoFocus />}
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. left some, ate well" />
      </label>
      <button
        className="btn btn-primary btn-xl"
        disabled={!food.trim()}
        onClick={() => {
          logFerret([{ cage_id: cage.id, kind: 'feed', food: food.trim(), notes: notes.trim() || null }], `${cage.name} fed – ${food.trim()}`);
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

function CleanSheet({ cage, onClose }: { cage: FerretCage; onClose: () => void }) {
  const { logFerret } = useStore();
  const [tasks, setTasks] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const toggle = (t: string) => setTasks((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  return (
    <Sheet title={`Cleaned – ${cage.name}`} onClose={onClose}>
      <div className="field">
        <span>What was done</span>
        <div className="segmented" role="group" aria-label="What was done">
          {CLEAN_TASKS.map((t) => (
            <button type="button" key={t.value} aria-pressed={tasks.includes(t.value)} className={tasks.includes(t.value) ? 'on' : ''} onClick={() => toggle(t.value)}>
              {tasks.includes(t.value) ? '✓ ' : ''}
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. bedding changed, hammock washed" />
      </label>
      {tasks.length === 0 && <p className="muted">Tick what was done.</p>}
      <button
        className="btn btn-primary btn-xl"
        disabled={tasks.length === 0}
        onClick={() => {
          logFerret([{ cage_id: cage.id, kind: 'clean', tasks, notes: notes.trim() || null }], `${cage.name} cleaned`);
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

/** Weigh each ferret: last weights, change since last time, one box to type today's */
function FerretWeigh() {
  const { ferrets, ferretCages, ferretLogs, today } = useStore();
  const [older, setOlder] = useState<FerretLog[]>([]);

  // A year of weights for the history (the app keeps only recent weeks on the phone)
  useEffect(() => {
    supabase
      .from('ferret_logs')
      .select('*')
      .eq('kind', 'weigh')
      .is('voided_at', null)
      .gte('log_date', addDays(today, -365))
      .order('logged_at')
      .then(({ data }) => data && setOlder(data as FerretLog[]));
  }, [today]);

  if (ferrets.length === 0) return <p className="empty">No ferrets set up yet. The admin can add them at the bottom of this page.</p>;
  const byId = new Map<string, FerretLog>();
  for (const l of [...older, ...ferretLogs]) if (l.kind === 'weigh') byId.set(l.id, l);
  const weights = [...byId.values()].sort((a, b) => b.logged_at.localeCompare(a.logged_at));
  const weighedToday = ferrets.filter((f) => weights.some((w) => w.ferret_id === f.id && w.log_date === today)).length;

  return (
    <>
      <section className={`counter ${weighedToday === ferrets.length ? 'counter-done' : 'counter-todo'}`}>
        <div className="counter-date">{formatDay(today)}</div>
        <div className="counter-big">
          {weighedToday} of {ferrets.length} weighed today
        </div>
      </section>
      {ferretCages.map((c) => {
        const here = ferrets.filter((f) => f.cage_id === c.id);
        if (here.length === 0) return null;
        return (
          <section key={c.id} className="aviary-group">
            <h2 className="aviary-title">{c.name}</h2>
            {here.map((f) => (
              <FerretWeighRow key={f.id} ferret={f} cage={c} weights={weights.filter((w) => w.ferret_id === f.id)} />
            ))}
          </section>
        );
      })}
      {ferrets.some((f) => !f.cage_id || !ferretCages.some((c) => c.id === f.cage_id)) && (
        <section className="aviary-group">
          <h2 className="aviary-title">No cage</h2>
          {ferrets
            .filter((f) => !f.cage_id || !ferretCages.some((c) => c.id === f.cage_id))
            .map((f) => (
              <FerretWeighRow key={f.id} ferret={f} cage={null} weights={weights.filter((w) => w.ferret_id === f.id)} />
            ))}
        </section>
      )}
    </>
  );
}

function FerretWeighRow({ ferret, cage, weights }: { ferret: Ferret; cage: FerretCage | null; weights: FerretLog[] }) {
  const { logFerret, today, logName, ferretCages } = useStore();
  const [value, setValue] = useState('');
  const [showAll, setShowAll] = useState(false);
  const last = weights[0];
  const prev = weights[1];
  const change = last?.weight_g != null && prev?.weight_g != null ? Math.round(last.weight_g - prev.weight_g) : null;
  const grams = Number(value.replace(',', '.'));
  const valid = value.trim() !== '' && grams > 0 && grams < 10000;

  function save() {
    if (!valid) return;
    const cageId = cage?.id ?? ferretCages[0]?.id;
    if (!cageId) return;
    logFerret([{ cage_id: cageId, kind: 'weigh', ferret_id: ferret.id, weight_g: Math.round(grams) }], `${ferret.name} weighed ${Math.round(grams)} g`);
    setValue('');
  }

  return (
    <div className={`clean-row ferret-weigh ${last?.log_date === today ? 'clean-ok' : 'clean-due'}`}>
      <div className="clean-info">
        <strong>{ferret.name}</strong>
        <div className="clean-last">
          {last?.weight_g != null ? (
            <>
              {Math.round(last.weight_g)} g · {last.log_date === today ? 'today' : formatDay(last.log_date)} by {logName(last)}
              {change != null && change !== 0 && <span className={change > 0 ? 'w-up' : 'w-down'}> ({change > 0 ? '+' : ''}{change} g)</span>}
              {last.pending && <span className="pending"> · not sent yet</span>}
            </>
          ) : (
            'Not weighed yet'
          )}
        </div>
      </div>
      <div className="ferret-weigh-input">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="grams"
          aria-label={`${ferret.name} weight in grams`}
        />
        <button className="btn btn-primary" disabled={!valid} onClick={save}>
          Save
        </button>
      </div>
      {weights.length > 1 && (
        <div className="ferret-history">
          <button className="btn btn-ghost" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? '▾' : '▸'} Previous weights ({weights.length - 1})
          </button>
          {showAll && (
            <ul>
              {weights.slice(1, 13).map((w) => (
                <li key={w.id}>
                  {formatDay(w.log_date)} – {Math.round(w.weight_g ?? 0)} g <span className="muted">{logName(w)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Admin: the ferret food buttons and each cage's numbers and names */
function FerretAdmin() {
  const { careSettings, ferretCages, ferrets, refresh } = useStore();
  const [newName, setNewName] = useState('');
  const [foods, setFoods] = useState((careSettings.ferret_foods?.length ? careSettings.ferret_foods : DEFAULT_FERRET_FOODS).join(', '));
  const [msg, setMsg] = useState<string | null>(null);

  async function saveFoods() {
    const list = foods.split(',').map((x) => x.trim()).filter(Boolean);
    const { error } = await supabase.from('care_settings').update({ ferret_foods: list }).eq('id', 1);
    setMsg(error ? error.message : 'Food list saved.');
    await refresh();
  }

  async function saveCage(c: FerretCage, changes: Partial<FerretCage>) {
    const { error } = await supabase.from('ferret_cages').update(changes).eq('id', c.id);
    setMsg(error ? error.message : `${c.name} saved.`);
    await refresh();
  }

  async function saveFerret(f: Ferret, changes: Partial<Ferret>) {
    const { error } = await supabase.from('ferrets').update(changes).eq('id', f.id);
    setMsg(error ? error.message : `${changes.name ?? f.name} saved.`);
    await refresh();
  }

  return (
    <details className="panel ferret-admin">
      <summary>
        <strong>Admin: food list, cages &amp; ferrets</strong>
      </summary>
      <label className="field">
        <span>
          Food buttons <small>separated by commas</small>
        </span>
        <input value={foods} onChange={(e) => setFoods(e.target.value)} />
      </label>
      <button className="btn btn-outline btn-lg" onClick={saveFoods}>
        Save food list
      </button>
      {ferretCages.map((c) => (
        <div key={c.id} className="field-row ferret-cage-edit">
          <label className="field">
            <span>{c.name}: how many</span>
            <input inputMode="numeric" defaultValue={c.ferrets} onBlur={(e) => Number(e.target.value) !== c.ferrets && saveCage(c, { ferrets: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="field">
            <span>Names</span>
            <input defaultValue={c.names ?? ''} placeholder="optional" onBlur={(e) => e.target.value.trim() !== (c.names ?? '') && saveCage(c, { names: e.target.value.trim() || null })} />
          </label>
        </div>
      ))}
      <h3 className="ferret-sub">Ferrets (for weighing)</h3>
      <p className="muted">Rename them to their real names any time; their weights stay with them.</p>
      {ferrets.map((f) => (
        <div key={f.id} className="field-row ferret-cage-edit">
          <label className="field">
            <span>Name</span>
            <input defaultValue={f.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && saveFerret(f, { name: e.target.value.trim() })} />
          </label>
          <label className="field">
            <span>Cage</span>
            <select value={f.cage_id ?? ''} onChange={(e) => saveFerret(f, { cage_id: e.target.value || null })}>
              <option value="">No cage</option>
              {ferretCages.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-outline" onClick={() => saveFerret(f, { archived: true })} aria-label={`Remove ${f.name}`}>
            Remove
          </button>
        </div>
      ))}
      <div className="field-row">
        <label className="field">
          <span>Add a ferret</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" />
        </label>
        <button
          className="btn btn-outline"
          disabled={!newName.trim()}
          onClick={async () => {
            const { error } = await supabase.from('ferrets').insert({ name: newName.trim(), cage_id: ferretCages[0]?.id ?? null, sort: ferrets.length + 1 });
            setMsg(error ? error.message : `${newName.trim()} added.`);
            setNewName('');
            await refresh();
          }}
        >
          Add
        </button>
      </div>
      {msg && <p className="muted">{msg}</p>}
    </details>
  );
}
