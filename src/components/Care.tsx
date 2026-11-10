import { I } from './Icon';
import { useState } from 'react';
import { CLEAN_LABEL, agoText, aviaryCleanState, bathNeeds, bathStatus, bathsToday, isWinter, openConcerns, sectionCleanToday } from '../care';
import { aviaryLabel } from '../aviary';
import { useTonightLow } from '../frost';
import { useStore } from '../store';
import { formatDay, formatTime } from '../time';
import { CLEAN_TASKS, type Aviary, type Bird, type CareLog } from '../types';
import { Sheet } from './Sheet';

const taskLabel = (t: string) => CLEAN_TASKS.find((c) => c.value === t)?.label ?? t;

export function describeClean(log: CareLog): string {
  const tasks = log.tasks.map((t) => (t === 'disinfect' && log.product ? `disinfected (${log.product})` : taskLabel(t).toLowerCase()));
  return tasks.join(', ');
}

/** Log a clean of one aviary, or of a whole daily section (e.g. the Mews) */
export function CleanSheet({ aviary, aviaries, section, onClose }: { aviary?: Aviary; aviaries?: Aviary[]; section?: string; onClose: () => void }) {
  const { logCare, careSettings } = useStore();
  const [tasks, setTasks] = useState<string[]>([]);
  const [product, setProduct] = useState(careSettings.products[0] ?? '');
  const [otherProduct, setOtherProduct] = useState(false);
  const [notes, setNotes] = useState('');
  const title = aviaries ? `${aviaries.length} aviaries in ${section}` : aviary ? aviaryLabel(aviary) : (section ?? '');
  const disinfecting = tasks.includes('disinfect');
  const canSave = tasks.length > 0 && (!disinfecting || !!product.trim());

  function toggle(t: string) {
    setTasks((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function save() {
    if (!canSave) return;
    const common = { tasks, product: disinfecting ? product.trim() : null, notes: notes.trim() || null };
    const targets = aviaries ?? (aviary ? [aviary] : []);
    logCare(
      targets.length > 0
        ? targets.map((a) => ({ kind: 'aviary_clean' as const, aviary_id: a.id, section: a.name, ...common }))
        : [{ kind: 'section_clean' as const, section: section ?? null, ...common }],
      `${title} cleaned`,
    );
    onClose();
  }

  return (
    <Sheet title={`Cleaned – ${title}`} onClose={onClose}>
      <div className="field">
        <span>What was done (tick all that apply)</span>
        <div className="food-grid" role="group" aria-label="What was done">
          {CLEAN_TASKS.map((t) => (
            <button type="button" key={t.value} aria-pressed={tasks.includes(t.value)} className={tasks.includes(t.value) ? 'on' : ''} onClick={() => toggle(t.value)}>
              {tasks.includes(t.value) ? '✓ ' : ''}
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {disinfecting && (
        <div className="field">
          <span>Disinfectant</span>
          <div className="food-grid" role="radiogroup" aria-label="Disinfectant">
            {careSettings.products.map((p) => (
              <button
                type="button"
                key={p}
                role="radio"
                aria-checked={!otherProduct && product === p}
                className={!otherProduct && product === p ? 'on' : ''}
                onClick={() => {
                  setOtherProduct(false);
                  setProduct(p);
                }}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={otherProduct}
              className={otherProduct ? 'on' : ''}
              onClick={() => {
                setOtherProduct(true);
                setProduct('');
              }}
            >
              Other
            </button>
          </div>
          {otherProduct && <input className="food-other" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product used" autoFocus />}
        </div>
      )}
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. perch loose, needs fixing" />
      </label>
      {tasks.length === 0 && <p className="muted">Tick what was done.</p>}
      <button className="btn btn-primary btn-xl" disabled={!canSave} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

/** One aviary's weekly cleaning status, with a CLEANED button and its bath */
export function AviaryCleanRow({ aviary, birds, onRemove, fromRota }: { aviary: Aviary; birds: Bird[]; onRemove?: () => void; fromRota?: boolean }) {
  const { careLogs, today, careSettings, logName } = useStore();
  const [open, setOpen] = useState(false);
  const { state, last, days } = aviaryCleanState(aviary, careLogs, today, careSettings);
  const doneToday = last?.log_date === today;
  return (
    <div className={`clean-row clean-${state}${onRemove ? ' plan-row' : ''}${onRemove && doneToday ? ' plan-done' : ''}`}>
      <div className="clean-info">
        <div className="clean-title">
          <strong>{aviaryLabel(aviary)}</strong> <span className="muted">{birds.map((b) => b.name).join(', ')}</span>
          {aviary.cold_spot && <span className="cold-tag"><I n="frost" size={15} /> cold spot</span>}
          {fromRota && <span className="rota-tag">rota</span>}
        </div>
        <div className="clean-last">
          {last ? (
            <>
              Cleaned {agoText(days)} by {logName(last)}
              {last.tasks.length > 0 && ` – ${describeClean(last)}`}
              {last.pending && <span className="pending"> · not sent yet</span>}
            </>
          ) : (
            'No clean logged yet'
          )}
        </div>
      </div>
      <span className={`chip clean-chip-${state}`}>{onRemove && doneToday ? '✓ Done' : CLEAN_LABEL[state]}</span>
      <BathLine aviary={aviary} />
      <div className="clean-actions">
        <button className="btn btn-outline btn-lg clean-btn" onClick={() => setOpen(true)}>
          Cleaned
        </button>
        {onRemove && (
          <button className="btn btn-outline plan-remove" onClick={onRemove} aria-label={`Take ${aviaryLabel(aviary)} off today's list`}>
            ✕
          </button>
        )}
      </div>
      {open && <CleanSheet aviary={aviary} onClose={() => setOpen(false)} />}
    </div>
  );
}

const BATH_STATE_TEXT = { ok: '', due: 'due', overdue: 'overdue', never: 'not logged' } as const;

/** "Bath: checked today · cleaned 2 days ago" with one-tap Checked / Cleaned */
export function BathLine({ aviary }: { aviary: Aviary }) {
  const { careLogs, today, careSettings, logCare } = useStore();
  const bath = bathStatus(aviary, careLogs, today, careSettings);
  if (!bath) return null;
  const needs = bathNeeds(bath);
  const part = (label: string, x: typeof bath.check) =>
    x.days == null ? `never ${label}` : `${label} ${agoText(x.days)}${x.state !== 'ok' ? ` (${BATH_STATE_TEXT[x.state]})` : ''}`;
  const log = (kind: 'bath_check' | 'bath_clean') =>
    logCare([{ kind, aviary_id: aviary.id, section: aviary.name }], `${aviaryLabel(aviary)} bath ${kind === 'bath_check' ? 'checked' : 'cleaned'}`);
  return (
    <div className={`bath-line${needs ? ` bath-needs-${needs}` : ''}`}>
      <span className="bath-text">
        <I n="bath" /> Bath {part('checked', bath.check)} · {part('cleaned', bath.clean)}
      </span>
      <span className="bath-btns">
        <button type="button" className="btn btn-outline bath-btn" onClick={() => log('bath_check')}>
          Bath checked
        </button>
        <button type="button" className="btn btn-outline bath-btn" onClick={() => log('bath_clean')}>
          Bath cleaned
        </button>
      </span>
    </div>
  );
}

/** Log a bath check for several aviaries at once (a morning walk round) */
export function BathsCheckedButton({ aviaries, label }: { aviaries: Aviary[]; label: string }) {
  const { logCare } = useStore();
  const [confirm, setConfirm] = useState(false);
  if (aviaries.length < 2) return null;
  if (confirm)
    return (
      <div className="confirm-inline">
        <span>Log {aviaries.length} baths in {label} as checked?</span>
        <button
          className="btn btn-primary"
          onClick={() => {
            logCare(aviaries.map((a) => ({ kind: 'bath_check' as const, aviary_id: a.id, section: a.name })), `${aviaries.length} baths checked in ${label}`);
            setConfirm(false);
          }}
        >
          Yes
        </button>
        <button className="btn btn-outline" onClick={() => setConfirm(false)}>
          No
        </button>
      </div>
    );
  return (
    <button className="btn btn-outline baths-all" onClick={() => setConfirm(true)}>
      <I n="bath" /> All {aviaries.length} baths checked
    </button>
  );
}

/** A section cleaned as a whole every day (e.g. the Mews) */
export function DailySectionCard({ section, count }: { section: string; count: number }) {
  const { careLogs, today, logName } = useStore();
  const [open, setOpen] = useState(false);
  const done = sectionCleanToday(section, careLogs, today);
  return (
    <div className={`clean-row ${done ? 'clean-ok' : 'clean-overdue'}`}>
      <div className="clean-info">
        <div className="clean-title">
          <strong>{section}</strong> <span className="muted">cleaned daily · {count} birds</span>
        </div>
        <div className="clean-last">
          {done ? (
            <>
              Done today {formatTime(done.logged_at)} by {logName(done)}
              {done.tasks.length > 0 && ` – ${describeClean(done)}`}
            </>
          ) : (
            'Not done today'
          )}
        </div>
      </div>
      <span className={`chip clean-chip-${done ? 'ok' : 'overdue'}`}>{done ? '✓ Done' : 'To do'}</span>
      <button className="btn btn-outline btn-lg clean-btn" onClick={() => setOpen(true)}>
        Cleaned
      </button>
      {open && <CleanSheet section={section} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Frost warning from tonight's forecast, with cold spots to check */
export function FrostBanner() {
  const { careSettings, aviaries } = useStore();
  const forecast = useTonightLow();
  if (!forecast || forecast.low > careSettings.frost_below) return null;
  const cold = aviaries.filter((a) => a.cold_spot && !a.archived);
  const at = forecast.lowAt ? forecast.lowAt.slice(11, 16) : '';
  return (
    <div className="frost-banner" role="alert">
      <strong><I n="frost" /> Frost tonight: down to {forecast.low.toString().replace('-', '−')} °C{at && ` around ${at}`}.</strong> Take baths in for the night
      {cold.length > 0 ? ` and check cold spots: ${cold.map((a) => aviaryLabel(a)).join(', ')}.` : '.'}
    </div>
  );
}

/** Winter (or frost) only: baths in at night, back out in the morning */
export function BathsCard() {
  const { careLogs, today, careSettings, logCare, logName } = useStore();
  const forecast = useTonightLow();
  const frost = !!forecast && forecast.low <= careSettings.frost_below;
  const { state, last } = bathsToday(careLogs, today);
  if (!isWinter(today, careSettings) && !frost && !state) return null;
  return (
    <section className="panel baths-card">
      <h2>Baths</h2>
      <p>
        {state === 'in' && last ? `Taken in for the night at ${formatTime(last.logged_at)} by ${logName(last)}.` : null}
        {state === 'out' && last ? `Put back out at ${formatTime(last.logged_at)} by ${logName(last)}.` : null}
        {!state && 'Winter: take baths in at night and put them back out in the morning.'}
      </p>
      <div className="bird-actions">
        <button className={`btn btn-lg ${state === 'in' ? 'btn-outline' : 'btn-primary'}`} onClick={() => logCare([{ kind: 'baths_in' }], 'Baths taken in for the night')}>
          Baths in for the night
        </button>
        <button className="btn btn-outline btn-lg" onClick={() => logCare([{ kind: 'baths_out' }], 'Baths back out')}>
          Baths back out
        </button>
      </div>
    </section>
  );
}

/** Raise a concern about a bird (R3: abnormalities / issues) */
export function ConcernSheet({ bird, onClose }: { bird: Bird; onClose: () => void }) {
  const { logCare } = useStore();
  const [notes, setNotes] = useState('');
  return (
    <Sheet title={`Concern – ${bird.name}`} onClose={onClose}>
      <label className="field">
        <span>What's the concern?</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. limping on left foot, not eating, bumblefoot" autoFocus />
      </label>
      <p className="muted">It stays at the top of Today until someone records the action taken. It also counts as {bird.name}'s check for today.</p>
      <button
        className="btn btn-primary btn-xl"
        disabled={!notes.trim()}
        onClick={() => {
          logCare([{ kind: 'bird_check', bird_id: bird.id, concern: true, notes: notes.trim() }], `Concern raised for ${bird.name}`);
          onClose();
        }}
      >
        Raise concern
      </button>
    </Sheet>
  );
}

/** Open concerns, each needing an action before it closes */
export function ConcernList() {
  const { careLogs, birds, logName, resolveConcern } = useStore();
  const [resolving, setResolving] = useState<CareLog | null>(null);
  const [action, setAction] = useState('');
  const open = openConcerns(careLogs);
  if (open.length === 0) return null;
  return (
    <section>
      <h2 className="concern-head"><I n="concern" /> Concerns ({open.length})</h2>
      <ul className="requests">
        {open.map((c) => (
          <li key={c.id} className="request concern">
            <div className="request-body">
              <strong>{birds.find((b) => b.id === c.bird_id)?.name ?? 'Bird'}: </strong>
              {c.notes}
              <div className="meta">
                {logName(c)} · {formatDay(c.log_date)} {formatTime(c.logged_at)}
                {c.pending && ' · not sent yet'}
              </div>
            </div>
            <button
              className="btn btn-outline"
              onClick={() => {
                setAction('');
                setResolving(c);
              }}
            >
              Action taken
            </button>
          </li>
        ))}
      </ul>
      {resolving && (
        <Sheet title="Action taken" onClose={() => setResolving(null)}>
          <p>
            <strong>{birds.find((b) => b.id === resolving.bird_id)?.name}:</strong> {resolving.notes}
          </p>
          <label className="field">
            <span>What was done?</span>
            <textarea rows={3} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. vet booked Tues, foot bathed, monitoring" autoFocus />
          </label>
          <button
            className="btn btn-primary btn-xl"
            disabled={!action.trim()}
            onClick={() => {
              resolveConcern(resolving.id, action);
              setResolving(null);
            }}
          >
            Save and close concern
          </button>
        </Sheet>
      )}
    </section>
  );
}
