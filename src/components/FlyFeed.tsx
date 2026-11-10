import { I, type IconName } from './Icon';
import { useState } from 'react';
import { FLIGHT_ORDER, hhmm, lastFlightType, rememberFlightType, todayAt } from '../flight';
import { feedLabel, formatQty, joinFeedItems, splitAmount, splitFeedItems, type FeedItem } from '../food';
import { birdStatus, needsFeeding, todaysFeed } from '../status';
import { useStore, type LogInput } from '../store';
import { formatTime } from '../time';
import { formatWeight } from '../weight';
import { flightTypeLabel, type Bird, type FeedLog, type FlightType } from '../types';
import { FlightTime } from './FlightParts';
import { FeedItemsEditor, QtyStepper } from './FoodPicker';
import { Sheet } from './Sheet';
import { WeightInput } from './WeightInput';

/** Flight type buttons (pick one) */
function TypePicker({ value, onChange }: { value: FlightType; onChange: (t: FlightType) => void }) {
  return (
    <div className="flight-types session-types" role="radiogroup" aria-label="Type of flight">
      {FLIGHT_ORDER.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} className={`btn btn-lg flight-type${value === t ? ' on' : ''}`} onClick={() => onChange(t)}>
          {flightTypeLabel(t)}
        </button>
      ))}
    </div>
  );
}

/** The foods given, with "still needs more later" */
function FeedFields({
  items,
  more,
  moreQty,
  onItems,
  onMore,
  onMoreQty,
}: {
  items: FeedItem[];
  more: boolean;
  moreQty: number;
  onItems: (items: FeedItem[]) => void;
  onMore: (more: boolean) => void;
  onMoreQty: (n: number) => void;
}) {
  const [active, setActive] = useState(0);
  return (
    <>
      <FeedItemsEditor items={items} active={active} onActive={setActive} onChange={onItems} />
      <label className="check">
        <input type="checkbox" checked={more} onChange={(e) => onMore(e.target.checked)} />
        <span>Still needs more food later today</span>
      </label>
      {more && <QtyStepper label={`How much more (${items.at(-1)?.food || 'food'})`} value={moreQty} onChange={onMoreQty} />}
    </>
  );
}

/**
 * Log a flight, a feed, or both at once: tick the halves that happened, fill
 * them in, save once. Both get the same time.
 */
export function FlyFeedSheet({ bird, onClose, onSaved }: { bird: Bird; onClose: () => void; onSaved?: (fed: boolean) => void }) {
  const { logFeeds, todayLogs, today } = useStore();
  const status = birdStatus(bird, todayLogs.filter((l) => l.bird_id === bird.id), today);
  const usual = todaysFeed(bird, status);
  const hungry = needsFeeding(status.state);

  const [time, setTime] = useState(() => hhmm(new Date()));
  const [fly, setFly] = useState(true);
  const [type, setType] = useState<FlightType>(lastFlightType);
  const [note, setNote] = useState('');
  const [feed, setFeed] = useState(hungry);
  const [items, setItems] = useState<FeedItem[]>([{ food: usual.food, qty: usual.qty }]);
  const [more, setMore] = useState(false);
  const [moreQty, setMoreQty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const when = todayAt(time);
  const inFuture = when != null && when.getTime() > Date.now() + 60_000;

  function save() {
    if (!fly && !feed) return setError('Tick Flown, Fed, or both.');
    if (!when || inFuture) return setError("That time hasn't happened yet today.");
    if (fly && type === 'other' && !note.trim()) return setError('Add a note saying what "Other" was.');
    if (feed && items.some((i) => !i.food.trim())) return setError('Pick the food.');
    const at = when.toISOString();
    const given = joinFeedItems(items);
    const entries: LogInput[] = [];
    if (fly) entries.push({ bird_id: bird.id, status: 'flown', food_type: null, amount: null, weight_g: null, notes: note.trim() || null, more_due: false, logged_at: at, flight_type: type });
    if (feed)
      entries.push({
        bird_id: bird.id,
        status: 'fed',
        food_type: given.food_type,
        amount: given.amount,
        weight_g: null,
        notes: fly ? 'On the glove' : null,
        more_due: more,
        more_due_amount: more ? feedLabel(formatQty(moreQty), items.at(-1)!.food.trim()) : null,
        logged_at: at,
      });
    if (fly) rememberFlightType(type);
    const parts = [fly ? `flown (${flightTypeLabel(type)})` : '', feed ? `fed ${feedLabel(given.amount, given.food_type)}` : ''].filter(Boolean).join(' + ');
    logFeeds(entries, `${bird.name}: ${parts} ${time}`, { alsoCheck: true });
    onClose();
    onSaved?.(feed);
  }

  const label = fly && feed ? 'Save flight and feed' : fly ? 'Save flight' : feed ? 'Save feed' : 'Save';

  return (
    <Sheet title={`${bird.name} – fly / feed`} onClose={onClose}>
      <FlightTime time={time} onChange={setTime} />

      <div className="flyfeed-toggles">
        <button type="button" className={`flyfeed-toggle${fly ? ' on' : ''}`} aria-pressed={fly} onClick={() => (setFly(!fly), setError(null))}>
          {fly ? '✓ ' : ''}<I n="fly" /> Flown
        </button>
        <button type="button" className={`flyfeed-toggle${feed ? ' on' : ''}`} aria-pressed={feed} onClick={() => (setFeed(!feed), setError(null))}>
          {feed ? '✓ ' : ''}<I n="food" /> Fed
        </button>
      </div>

      {fly && (
        <section className="flyfeed-part">
          <TypePicker value={type} onChange={setType} />
          <label className="field">
            <span>Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Smith family, flew well" />
          </label>
        </section>
      )}
      {feed && (
        <section className="flyfeed-part">
          {!hungry && <p className="muted">{bird.name} has already been fed today; this adds another feed.</p>}
          <FeedFields items={items} more={more} moreQty={moreQty} onItems={setItems} onMore={setMore} onMoreQty={setMoreQty} />
        </section>
      )}

      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={!fly && !feed} onClick={save}>
        {label}
      </button>
    </Sheet>
  );
}

/** Icon for one of today's entries */
export function entryIcon(l: FeedLog): IconName {
  return l.status === 'flown' ? 'fly' : l.status === 'fed' ? 'food' : l.status === 'left' ? 'left' : l.status === 'fasting' ? 'calendar' : 'weigh';
}

/** Short text for one of today's entries */
export function entryText(l: FeedLog, bird: Bird): string {
  if (l.status === 'flown') return `${formatTime(l.logged_at)} ${flightTypeLabel(l.flight_type) ?? 'Flown'}`;
  if (l.status === 'fed') return `${formatTime(l.logged_at)} ${feedLabel(l.amount, l.food_type) || 'Fed'}${l.more_due ? ' (more due)' : ''}`;
  if (l.status === 'fasting') return `${formatTime(l.logged_at)} Fasting`;
  if (l.status === 'left') return `${formatTime(l.logged_at)} Left ${feedLabel(l.amount, l.food_type) || 'food'}`;
  const w = l.weight_g != null ? formatWeight(l.weight_g, bird.weight_unit) : '';
  const f = l.food_type || l.amount ? `food set: ${feedLabel(l.amount, l.food_type)}` : '';
  return `${formatTime(l.logged_at)} ${[w, f].filter(Boolean).join(' · ')}`;
}

/** Today's entries for a bird as tappable chips; tap one to change or remove it */
export function TodayEntries({ bird }: { bird: Bird }) {
  const { todayLogs, logName } = useStore();
  const [editing, setEditing] = useState<FeedLog | null>(null);
  const logs = todayLogs.filter((l) => l.bird_id === bird.id);
  if (logs.length === 0) return null;
  return (
    <div className="today-entries">
      {logs.map((l) => (
        <button key={l.id} type="button" className={`entry-chip entry-${l.status}`} onClick={() => setEditing(l)} aria-label={`Change: ${entryText(l, bird)}`}>
          <I n={entryIcon(l)} size={15} /> {entryText(l, bird)}
          <span className="entry-who"> · {logName(l)}</span>
          {l.pending && <span className="pending"> · not sent</span>}
          <span className="entry-edit" aria-hidden="true">
            ✎
          </span>
        </button>
      ))}
      {editing && <EditLogSheet log={editing} bird={bird} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Change a logged feed, flight or weight (saved as a correction), or remove it */
export function EditLogSheet({ log, bird, onClose }: { log: FeedLog; bird: Bird; onClose: () => void }) {
  const { correctLog, voidLog } = useStore();
  const parsed = splitFeedItems(log.amount, log.food_type);
  const moreParts = log.more_due_amount ? splitAmount(log.more_due_amount, null) : null;
  const [time, setTime] = useState(() => hhmm(new Date(log.logged_at)));
  const [type, setType] = useState<FlightType>(log.flight_type ?? 'experience');
  const [note, setNote] = useState(log.notes ?? '');
  const [items, setItems] = useState<FeedItem[]>(() => parsed ?? [{ food: log.food_type ?? '', qty: 1 }]);
  const [more, setMore] = useState(log.more_due);
  const [moreQty, setMoreQty] = useState(moreParts?.qty ?? 1);
  const [weight, setWeight] = useState<number | null>(log.weight_g);
  const [badWeight, setBadWeight] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const when = todayAt(time);
  const inFuture = when != null && when.getTime() > Date.now() + 60_000;
  // Feeds written as text we can't step (e.g. "half leg") are kept as typed
  const freeAmount = log.status === 'fed' && log.amount && !parsed;
  const [amountText, setAmountText] = useState(log.amount ?? '');

  function save() {
    if (!when || inFuture) return setError("That time hasn't happened yet today.");
    const at = when.toISOString();
    let next: LogInput;
    if (log.status === 'flown') {
      if (type === 'other' && !note.trim()) return setError('Add a note saying what "Other" was.');
      next = { bird_id: bird.id, status: 'flown', food_type: null, amount: null, weight_g: null, notes: note.trim() || null, more_due: false, logged_at: at, flight_type: type, session_id: log.session_id ?? null };
    } else if (log.status === 'fed') {
      if (!freeAmount && items.some((i) => !i.food.trim())) return setError('Pick the food.');
      const given = joinFeedItems(items);
      next = {
        bird_id: bird.id,
        status: 'fed',
        food_type: freeAmount ? log.food_type : given.food_type,
        amount: freeAmount ? amountText.trim() || null : given.amount,
        weight_g: null,
        notes: log.notes,
        more_due: more,
        more_due_amount: more ? feedLabel(formatQty(moreQty), items.at(-1)?.food.trim() || log.food_type) : null,
        logged_at: at,
        session_id: log.session_id ?? null,
      };
    } else if (log.status === 'weighed') {
      if (badWeight) return setError('Check the weight.');
      next = { bird_id: bird.id, status: 'weighed', food_type: log.food_type, amount: log.amount, weight_g: weight, notes: log.notes, more_due: false, logged_at: at };
    } else {
      next = { bird_id: bird.id, status: log.status, food_type: null, amount: null, weight_g: null, notes: log.notes, more_due: false, logged_at: at };
    }
    correctLog(log, next);
    onClose();
  }

  return (
    <Sheet title={`Change – ${bird.name}`} onClose={onClose}>
      <FlightTime time={time} onChange={setTime} />
      {log.status === 'flown' && (
        <>
          <TypePicker value={type} onChange={setType} />
          <label className="field">
            <span>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </>
      )}
      {log.status === 'fed' &&
        (freeAmount ? (
          <label className="field">
            <span>What was fed</span>
            <input value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
        ) : (
          <FeedFields items={items} more={more} moreQty={moreQty} onItems={setItems} onMore={setMore} onMoreQty={setMoreQty} />
        ))}
      {log.status === 'weighed' && (
        <WeightInput label="Weight" unit={bird.weight_unit} grams={weight} onChange={(g, invalid) => (setWeight(g), setBadWeight(invalid))} />
      )}
      <p className="muted">The original is kept on record, marked as changed by you.</p>
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" onClick={save}>
        Save change
      </button>
      {confirmRemove ? (
        <div className="confirm-inline">
          <span>Remove this entry? It stays on record as removed by you.</span>
          <button
            className="btn btn-danger"
            onClick={() => {
              voidLog(log.id);
              onClose();
            }}
          >
            Remove
          </button>
          <button className="btn btn-outline" onClick={() => setConfirmRemove(false)}>
            Keep
          </button>
        </div>
      ) : (
        <button className="btn btn-outline btn-lg remove-entry" onClick={() => setConfirmRemove(true)}>
          Remove this entry
        </button>
      )}
    </Sheet>
  );
}
