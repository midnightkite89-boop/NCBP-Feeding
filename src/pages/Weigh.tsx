import { I } from '../components/Icon';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FoodPicker, QtyStepper } from '../components/FoodPicker';
import { BirdPhoto } from '../components/BirdPhoto';
import { WeighModeTabs } from './Records';
import { WeightInput } from '../components/WeightInput';
import { aviaryLabel, routeSort, sectionRuns } from '../aviary';
import { feedLabel, formatQty } from '../food';
import { useStore } from '../store';
import { birdStatus, targetRange, todaysFeed, weightWarning, type BirdStatus } from '../status';
import { supabase } from '../supabase';
import { addDays, formatDay, formatTime } from '../time';
import type { Aviary, Bird } from '../types';
import { isWeighed } from '../types';
import { GRAMS_PER_OZ, formatWeight, type WeightUnit } from '../weight';

interface PastWeight {
  weight_g: number;
  log_date: string;
}

/**
 * Weigh-in screen, built for a tablet: birds by section on the left, the
 * selected bird on the right. On a phone it shows one side at a time.
 */
export function Weigh() {
  const { birds, aviaries, todayLogs, today, loading } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The bird to bring back into view when returning to the list on a phone
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);

  const narrow = () => window.matchMedia('(max-width: 767px)').matches;

  function open(id: string) {
    setSelectedId(id);
    // On a phone the list is hidden, so start the bird's screen at the top
    if (narrow()) window.scrollTo(0, 0);
  }

  function back() {
    setReturnTo(selectedId);
    setSelectedId(null);
  }

  // Once the list is showing again, scroll to the bird you were on
  useLayoutEffect(() => {
    if (!returnTo || selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-bird="${returnTo}"]`);
    row?.scrollIntoView({ block: 'center' });
    const t = window.setTimeout(() => setReturnTo(null), 2500);
    return () => window.clearTimeout(t);
  }, [returnTo, selectedId]);
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [previous, setPrevious] = useState<Record<string, PastWeight>>({});

  // Each bird's most recent weight before today, for comparison
  useEffect(() => {
    supabase
      .from('feed_logs')
      .select('bird_id, weight_g, log_date')
      .not('weight_g', 'is', null)
      .is('voided_at', null)
      .lt('log_date', today)
      .gte('log_date', addDays(today, -60))
      .order('logged_at', { ascending: false })
      .then(({ data }) => {
        const map: Record<string, PastWeight> = {};
        for (const row of (data ?? []) as (PastWeight & { bird_id: string })[]) if (!map[row.bird_id]) map[row.bird_id] = row;
        setPrevious(map);
      });
  }, [today]);

  const statuses = useMemo(() => {
    const m = new Map<string, BirdStatus>();
    for (const b of birds) m.set(b.id, birdStatus(b, todayLogs.filter((l) => l.bird_id === b.id), today));
    return m;
  }, [birds, todayLogs, today]);

  // Section by section, in feeding-round order
  const sections = useMemo(() => {
    const byId = new Map(aviaries.map((a) => [a.id, a]));
    const ordered = routeSort(birds.filter((b) => b.status === 'active' && isWeighed(b)), aviaries);
    return sectionRuns(ordered, aviaries).map((run) => ({
      key: run.key,
      title: run.title,
      birds: run.birds.map((bird) => ({ bird, aviary: bird.aviary_id ? byId.get(bird.aviary_id) : undefined })),
    }));
  }, [birds, aviaries]);

  const order = sections.flatMap((s) => s.birds.map((x) => x.bird));
  const weighedCount = order.filter((b) => statuses.get(b.id)?.weighIn).length;
  const selected = birds.find((b) => b.id === selectedId) ?? null;

  /** After saving, move on to the next bird not yet weighed today. */
  function next(afterId: string) {
    const i = order.findIndex((b) => b.id === afterId);
    const rest = [...order.slice(i + 1), ...order.slice(0, i)];
    const nextBird = rest.find((b) => b.id !== afterId && !statuses.get(b.id)?.weighIn);
    if (nextBird) open(nextBird.id);
    else back();
  }

  if (loading) return <p className="empty">Loading…</p>;

  return (
    <>
      <WeighModeTabs mode="weigh" />
    <div className="weigh" data-open={selected ? 'true' : 'false'}>
      <aside className="weigh-list" ref={listRef}>
        <div className="weigh-count">
          <strong>
            {weighedCount} of {order.length}
          </strong>{' '}
          weighed today
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} />
          <span>Not weighed yet only</span>
        </label>
        {sections.map((section) => {
          const rows = section.birds.filter(({ bird }) => !onlyTodo || !statuses.get(bird.id)?.weighIn);
          if (rows.length === 0) return null;
          return (
            <section key={section.key}>
              <h2 className="weigh-section">{section.title}</h2>
              <ul>
                {rows.map(({ bird, aviary }) => {
                  const st = statuses.get(bird.id)!;
                  const w = st.weighIn?.weight_g ?? null;
                  const warn = weightWarning(bird, w);
                  return (
                    <li key={bird.id}>
                      <button
                        data-bird={bird.id}
                        className={`weigh-row${bird.id === selectedId ? ' on' : ''}${bird.id === returnTo ? ' just-left' : ''}${w != null ? ' done' : ''}`}
                        onClick={() => open(bird.id)}
                      >
                        <span className="weigh-num">{aviary?.number ?? '–'}</span>
                        <span className="weigh-name">{bird.name}</span>
                        <span className={`weigh-val${warn ? ' warn-text' : ''}`}>{w != null ? `✓ ${formatWeight(w, bird.weight_unit)}` : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </aside>

      <div className="weigh-panel">
        {selected ? (
          <WeighPanel
            key={`${selected.id}-${statuses.get(selected.id)?.weighIn?.id ?? 'new'}`}
            bird={selected}
            aviary={aviaries.find((a) => a.id === selected.aviary_id)}
            status={statuses.get(selected.id)!}
            previous={previous[selected.id]}
            onBack={back}
            onSaved={() => next(selected.id)}
          />
        ) : (
          <p className="empty">Pick a bird on the left to weigh it.</p>
        )}
      </div>
    </div>
    </>
  );
}

function WeighPanel({
  bird,
  aviary,
  status,
  previous,
  onBack,
  onSaved,
}: {
  bird: Bird;
  aviary?: Aviary;
  status: BirdStatus;
  previous?: PastWeight;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { logFeeds, logName } = useStore();
  const usual = todaysFeed(bird, status);
  const [grams, setGrams] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [setFood, setSetFood] = useState(!!status.planned);
  const [food, setFoodName] = useState(usual.food);
  const [qty, setQty] = useState(usual.qty);
  const [notes, setNotes] = useState('');

  const warning = invalid ? null : weightWarning(bird, grams);
  const foodOk = !setFood || !!food.trim();
  const canSave = !invalid && foodOk && (grams != null || setFood);

  function save() {
    if (!canSave) return;
    logFeeds(
      [
        {
          bird_id: bird.id,
          status: 'weighed',
          food_type: setFood ? food.trim() : null,
          amount: setFood ? formatQty(qty) : null,
          weight_g: grams,
          notes: notes.trim() || null,
          more_due: false,
        },
      ],
      `${bird.name}${grams != null ? ` ${formatWeight(grams, bird.weight_unit)}` : ''}${setFood ? ` · ${feedLabel(formatQty(qty), food.trim())}` : ''}`,
    );
    onSaved();
  }

  return (
    <div className="weigh-form">
      <button className="btn btn-outline weigh-back" onClick={onBack}>
        ← All birds
      </button>
      <div className="bird-head">
        <BirdPhoto bird={bird} size={72} />
        <div className="bird-title">
          <div className="bird-name">{bird.name}</div>
          <div className="species">
            {bird.species}
            {aviary && ` · ${aviaryLabel(aviary)}`}
          </div>
        </div>
      </div>

      <dl className="facts weigh-facts">
        <dt>Target</dt>
        <dd>{targetRange(bird) ?? '—'}</dd>
        <dt>Last weight</dt>
        <dd>{previous ? `${formatWeight(previous.weight_g, bird.weight_unit)} · ${formatDay(previous.log_date)}` : '—'}</dd>
        {status.weighIn && (
          <>
            <dt>Today</dt>
            <dd>
              {formatWeight(status.weighIn.weight_g, bird.weight_unit)} at {formatTime(status.weighIn.logged_at)} by {logName(status.weighIn)}
            </dd>
          </>
        )}
      </dl>

      <div className="weigh-input">
        <WeightInput
          label={status.weighIn ? 'Weigh again' : 'Weight'}
          unit={bird.weight_unit ?? 'g'}
          grams={null}
          onChange={(g, bad) => {
            setGrams(g);
            setInvalid(bad);
          }}
        />
      </div>
      {invalid && <p className="warn">That doesn't look like a weight.</p>}
      {grams != null && previous && <p className="weigh-diff">{changeSince(grams, previous.weight_g, bird.weight_unit)} since last weighed</p>}
      {warning && <p className="warn"><I n="concern" /> {warning}</p>}

      <label className="check">
        <input type="checkbox" checked={setFood} onChange={(e) => setSetFood(e.target.checked)} />
        <span>Set today's food</span>
      </label>
      {setFood && (
        <div className="panel">
          <FoodPicker value={food} onChange={setFoodName} />
          <QtyStepper value={qty} onChange={setQty} />
          <p className="muted">This becomes the green FED button for {bird.name} today.</p>
        </div>
      )}

      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <button className="btn btn-primary btn-xl" disabled={!canSave} onClick={save}>
        Save &amp; next bird
      </button>
    </div>
  );
}

/** e.g. "+12 g" or "−1.5 oz" */
function changeSince(now: number, before: number, unit: WeightUnit): string {
  const diff = now - before;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  if (unit === 'lb_oz') return `${sign}${Math.round((Math.abs(diff) / GRAMS_PER_OZ) * 100) / 100} oz`;
  return `${sign}${Math.round(Math.abs(diff) * 10) / 10} g`;
}
