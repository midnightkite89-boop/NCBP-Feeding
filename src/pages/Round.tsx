import { I } from '../components/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { aviaryLabel, feedStops, routeSort } from '../aviary';
import { useAviaryStop } from '../components/AviaryStop';
import { birdCheckToday, openConcerns } from '../care';
import { ConcernSheet } from '../components/Care';
import { FlyFeedSheet, TodayEntries } from '../components/FlyFeed';
import { FeedItemsEditor } from '../components/FoodPicker';
import { RequestList } from '../components/RequestList';
import { useStore } from '../store';
import { birdStatus, needsFeeding, quickFeedEntry, quickFeedLabel, weightWarning } from '../status';
import { roundNames, type Bird } from '../types';
import { formatWeight } from '../weight';
import { QTY_MAX, QTY_MIN, QTY_STEP, feedLabel, joinFeedItems, splitFeedItems, type FeedItem } from '../food';
import { dosesToday, photoStatus } from '../health';
import { HealthAlerts } from '../components/HealthAlerts';
import { LeftoverLine, LeftoverSheet } from '../components/Leftovers';
import { has } from '../centre';

const ROUND_KEY = 'smj-round-at';
/** Set once the briefing has been read on this phone today */
const BRIEFED_KEY = 'smj-round-briefed';

/** With more than one round, pick which one first */
export function Round() {
  const { careSettings } = useStore();
  const [params] = useSearchParams();
  const names = roundNames(careSettings);
  const r = Number(params.get('r'));
  if (names.length > 1 && !(r >= 1 && r <= names.length))
    return (
      <div className="round-choose">
        <h1 className="page-title">Which round?</h1>
        {names.map((n, i) => (
          <Link key={n} to={`/round?r=${i + 1}`} className="btn btn-primary btn-xl">
            <I n="round" /> {n}
          </Link>
        ))}
        <Link to="/" className="btn btn-outline btn-lg">
          Cancel
        </Link>
      </div>
    );
  const round = names.length > 1 ? r : 1;
  return <RoundOf key={round} round={round} />;
}

/**
 * Feeding round: one bird at a time in walking order. Skips birds already fed,
 * and fast-day birds once checked. FED logs the feed and the daily check, then moves on.
 */
function RoundOf({ round }: { round: number }) {
  const KEY = `${ROUND_KEY}-${round}`;
  const navigate = useNavigate();
  const { birds, aviaries, todayLogs, careLogs, today, logFeeds, logCare, requests, loading, medications, doses, giveDose, careSettings } = useStore();
  const medsLeft = (b: Bird) => dosesToday(medications.filter((m) => m.bird_id === b.id), doses, today).reduce((n, x) => n + x.left, 0);
  const [briefed, setBriefed] = useState(() => {
    try {
      return sessionStorage.getItem(`${BRIEFED_KEY}-${round}`) === today;
    } catch {
      return false;
    }
  });
  const birdOrder = useMemo(
    () =>
      routeSort(
        birds.filter((b) => b.status === 'active' && (b.feed_round ?? 1) === round),
        aviaries,
      ),
    [birds, aviaries, round],
  );
  // Aviary birds sharing an aviary are one stop, led by the first of them
  const stops = useMemo(() => feedStops(birdOrder), [birdOrder]);
  const order = useMemo(() => stops.map((s) => s[0]), [stops]);
  const matesOf = (b: Bird) => stops.find((s) => s[0].id === b.id) ?? [b];
  const stopName = (b: Bird) => {
    const mates = matesOf(b);
    const av = aviaries.find((a) => a.id === b.aviary_id);
    return mates.length > 1 && av ? aviaryLabel(av) : b.name;
  };

  const statusOf = (b: Bird) =>
    birdStatus(
      b,
      todayLogs.filter((l) => l.bird_id === b.id),
      today,
    );
  // Fed birds are done (feeding counts as seeing them). Birds not being fed today
  // (fast day, fasting) are done once checked.
  const isDone = (b: Bird) => matesOf(b).every(isBirdDone);
  const isBirdDone = (b: Bird) => {
    const state = statusOf(b).state;
    if (needsFeeding(state)) return false;
    // A bird isn't done while it still has medication due today
    if (medsLeft(b) > 0) return false;
    return state === 'fed' || !!birdCheckToday(b.id, careLogs, today);
  };
  const doneCount = order.filter(isDone).length;

  // Pick up where this phone left off, else the first bird still to do
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const [sheet, setSheet] = useState<'flown' | 'concern' | 'left' | null>(null);
  // Foods picked instead of the usual feed, for this bird only (null = usual)
  const [override, setOverride] = useState<FeedItem[] | null>(null);
  const [activeFood, setActiveFood] = useState(0);
  useEffect(() => {
    setOverride(null);
    setActiveFood(0);
  }, [currentId]);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    if (loading || order.length === 0) return;
    if (!currentId || !order.some((b) => b.id === currentId)) setCurrentId(order.find((b) => !isDone(b))?.id ?? null);
  }, [loading, order.length]);

  useEffect(() => {
    try {
      if (currentId) sessionStorage.setItem(KEY, currentId);
    } catch {
      /* ignore */
    }
  }, [currentId]);

  useEffect(() => () => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
  }, []);

  if (loading) return <p className="empty">Loading…</p>;

  const index = order.findIndex((b) => b.id === currentId);
  const bird = index >= 0 ? order[index] : null;
  const nextTodo = (from: number) => order.slice(from + 1).find((b) => !isDone(b)) ?? order.slice(0, Math.max(0, from)).find((b) => !isDone(b)) ?? null;

  function goNext() {
    const n = nextTodo(index);
    setCurrentId(n?.id ?? null);
  }

  function endRound() {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    navigate('/');
  }

  const header = (
    <div className="round-top">
      <button className="btn btn-ghost round-end" onClick={endRound}>
        ✕ End round
      </button>
      <span className="muted">
        {roundNames(careSettings).length > 1 && <strong>{roundNames(careSettings)[round - 1]} · </strong>}
        {doneCount} of {order.length} done · {order.length - doneCount} left
      </span>
    </div>
  );
  const progress = (
    <div className="round-progress" aria-hidden="true">
      <div style={{ width: `${order.length ? (doneCount / order.length) * 100 : 0}%` }} />
    </div>
  );

  if (!briefed && order.length > 0)
    return (
      <RoundBriefing
        title={roundNames(careSettings).length > 1 ? roundNames(careSettings)[round - 1] : "Today's round"}
        order={birdOrder}
        statusOf={statusOf}
        onStart={() => {
          try {
            sessionStorage.setItem(`${BRIEFED_KEY}-${round}`, today);
          } catch {
            /* ignore */
          }
          setBriefed(true);
        }}
        onCancel={endRound}
      />
    );

  if (!bird) {
    return (
      <div className="round">
        {header}
        {progress}
        <div className="round-finished">
          <div className="round-tick">✓</div>
          <h1>Round complete</h1>
          <p className="muted">Every bird is fed, or checked if it isn't being fed today.</p>
          <button className="btn btn-primary btn-xl" onClick={endRound}>
            Back to Today
          </button>
        </div>
      </div>
    );
  }

  const mates = matesOf(bird);
  if (mates.length > 1)
    return (
      <div className="round">
        {header}
        {progress}
        <RoundAviaryStop
          key={bird.id}
          birds={mates}
          onFed={() => {
            if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
            if (mates.some((m) => medsLeft(m) > 0)) return;
            advanceTimer.current = window.setTimeout(goNext, 700);
          }}
        />
        <div className="round-nav">
          <button className="btn btn-outline btn-lg" disabled={index <= 0} onClick={() => index > 0 && setCurrentId(order[index - 1].id)}>
            ← Back
          </button>
          <button className="btn btn-primary btn-lg round-next" onClick={goNext}>
            {nextTodo(index) ? `Next: ${stopName(nextTodo(index)!)} →` : 'Finish ✓'}
          </button>
        </div>
      </div>
    );

  const status = statusOf(bird);
  const { state, weight, stillToGive, planned } = status;
  const checked = birdCheckToday(bird.id, careLogs, today);
  const concern = openConcerns(careLogs).find((c) => c.bird_id === bird.id);
  const aviary = aviaries.find((a) => a.id === bird.aviary_id);
  const warning = weightWarning(bird, weight);
  const next = nextTodo(index);
  const prev = index > 0 ? order[index - 1] : null;

  // The feed as it'll be logged, with any − / + applied
  const baseEntry = quickFeedEntry(bird, status);
  const baseItems = splitFeedItems(baseEntry.amount, baseEntry.food_type);
  const items = override ?? baseItems;
  const changed = override != null;
  const given = changed && items ? joinFeedItems(items) : null;
  const entry = given ? { ...baseEntry, ...given } : baseEntry;
  const feedText = given ? feedLabel(given.amount, given.food_type) : quickFeedLabel(bird, status);
  const activeItem = items?.[Math.min(activeFood, items.length - 1)];
  const nudge = (d: number) => {
    if (!items || !activeItem) return;
    const qty = Math.min(QTY_MAX, Math.max(QTY_MIN, activeItem.qty + d * QTY_STEP));
    setOverride(items.map((it) => (it === activeItem ? { ...it, qty } : it)));
  };
  const pickerItems = items ?? [{ food: baseEntry.food_type ?? '', qty: 1 }];

  const birdMeds = dosesToday(medications.filter((m) => m.bird_id === bird.id), doses, today).filter((x) => x.left > 0);

  function fed() {
    logFeeds([entry], `${bird!.name} fed – ${feedText}`, { alsoCheck: true });
    setOverride(null);
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    // Medication still to give: stay on this bird
    if (birdMeds.length > 0) return;
    // A moment to see it register, then on to the next bird
    advanceTimer.current = window.setTimeout(goNext, 700);
  }

  function gave(med: (typeof birdMeds)[number]['med']) {
    giveDose(med, `${bird!.name}: ${med.name_dose} given`);
    const lastDose = birdMeds.length === 1 && birdMeds[0].left === 1;
    // Fed and nothing more to give: on to the next bird
    if (lastDose && !needsFeeding(state)) {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(goNext, 700);
    }
  }

  function checkOnly() {
    logCare([{ kind: 'bird_check', bird_id: bird!.id }], `${bird!.name} checked`);
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(goNext, 700);
  }

  return (
    <div className="round">
      {header}
      {progress}
      <div className="round-bird">
        <div className="round-aviary">{aviary ? aviaryLabel(aviary) : 'No aviary'}</div>
        <h1 className="round-name">{bird.name}</h1>
        <div className="muted">
          {bird.species}
          {weight != null && ` · ${formatWeight(weight, bird.weight_unit)}`}
        </div>
        {warning && <p className="warn"><I n="concern" /> {warning}</p>}
        {birdMeds.length > 0 && (
          <div className="round-meds" role="alert">
            {birdMeds.map(({ med, given, left }) => (
              <div key={med.id} className="round-med">
                <div className="round-med-info">
                  <strong><I n="meds" /> {med.name_dose}</strong>
                  <div>
                    {med.amount}
                    {med.times_per_day > 1 && ` · dose ${given.length + 1} of ${med.times_per_day}`}
                    {med.notes && <strong> · {med.notes}</strong>}
                  </div>
                </div>
                <button className="btn btn-primary round-med-btn" onClick={() => gave(med)} aria-label={`${med.name_dose} given`}>
                  Given{left > 1 ? ` (${left} left)` : ''}
                </button>
              </div>
            ))}
          </div>
        )}
        <HealthAlerts bird={bird} />
        <TodayEntries bird={bird} />
        {stillToGive && <p className="still-to-give">Still to give: {stillToGive}</p>}
        {!stillToGive && planned && needsFeeding(state) && <p className="planned-food">Today's food: {planned.label}</p>}
        {concern && <p className="concern-line"><I n="concern" /> {concern.notes}</p>}
        {has('leftovers') && <LeftoverLine birds={[bird]} />}
        {bird.care_notes && <p className="care-notes">{bird.care_notes}</p>}
        <RequestList requests={requests.filter((r) => r.bird_id === bird.id)} showBird={false} />
      </div>

      <div className="round-actions">
        {needsFeeding(state) ? (
          <div className="round-fed-row">
            {activeItem && (
              <button className="btn btn-outline qty-nudge" onClick={() => nudge(-1)} disabled={activeItem.qty <= QTY_MIN} aria-label="Half less">
                −
              </button>
            )}
            <button className={`btn btn-feed btn-xl round-fed${changed ? ' nudged' : ''}`} onClick={fed}>
              <span className="btn-main">FED</span>
              <span className="btn-sub">
                {feedText}
                {changed ? ` (usual ${quickFeedLabel(bird, status)})` : has('dailyChecks') ? ' · also logs checked' : ''}
              </span>
            </button>
            {activeItem && (
              <button className="btn btn-outline qty-nudge" onClick={() => nudge(1)} aria-label="Half more">
                +
              </button>
            )}
          </div>
        ) : state === 'fastday' && !checked ? (
          <>
            <div className="fast-banner">FAST DAY – do not feed</div>
            <button className="btn btn-primary btn-xl" onClick={checkOnly}>
              ✓ Checked
            </button>
          </>
        ) : state === 'fasting' && !checked ? (
          <button className="btn btn-primary btn-xl" onClick={checkOnly}>
            ✓ Checked
          </button>
        ) : (
          <div className="round-done-note">{state === 'fastday' || state === 'fasting' ? '✓ Fast day · checked' : '✓ Fed'}</div>
        )}
        {needsFeeding(state) && (
          <div className="round-food">
            <FeedItemsEditor key={bird.id} items={pickerItems} active={activeFood} onActive={setActiveFood} onChange={setOverride} showQty={false} />
          </div>
        )}
        <div className="round-row">
          {has('leftovers') && (
            <button className="btn btn-outline btn-lg" onClick={() => setSheet('left')}>
              <I n="left" /> Food left
            </button>
          )}
          {bird.team !== 'aviary' && (
            <button className="btn btn-outline btn-lg" onClick={() => setSheet('flown')}>
              <I n="fly" /> Fly / Feed
            </button>
          )}
          <button className="btn btn-outline btn-lg round-concern" onClick={() => setSheet('concern')}>
            <I n="concern" /> Concern
          </button>
        </div>
      </div>

      <div className="round-nav">
        <button className="btn btn-outline btn-lg" disabled={!prev} onClick={() => prev && setCurrentId(prev.id)}>
          ← Back
        </button>
        <button className="btn btn-primary btn-lg round-next" onClick={goNext}>
          {next ? `Next: ${stopName(next)} →` : 'Finish ✓'}
        </button>
      </div>
      <p className="round-skip-note muted">
        <Link to={`/bird/${bird.id}`}>History</Link>
      </p>

      {sheet === 'flown' && (
        <FlyFeedSheet
          bird={bird}
          onClose={() => setSheet(null)}
          onSaved={(wasFed) => {
            // Fed through here counts the same as FED: on to the next bird
            if (!wasFed || birdMeds.length > 0) return;
            if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
            advanceTimer.current = window.setTimeout(goNext, 700);
          }}
        />
      )}
      {sheet === 'left' && <LeftoverSheet birds={[bird]} onClose={() => setSheet(null)} />}
      {sheet === 'concern' && <ConcernSheet bird={bird} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** One stop for a shared aviary: every bird in it fed with one FED, food left logged for the aviary */
function RoundAviaryStop({ birds, onFed }: { birds: Bird[]; onFed: () => void }) {
  const stop = useAviaryStop(birds);
  const { medications, doses, today, giveDose } = useStore();
  const [leftOpen, setLeftOpen] = useState(false);
  const meds = birds.flatMap((b) =>
    dosesToday(medications.filter((m) => m.bird_id === b.id), doses, today)
      .filter((x) => x.left > 0)
      .map((x) => ({ ...x, bird: b })),
  );
  return (
    <>
      <div className="round-bird">
        <div className="round-aviary">Shared aviary</div>
        <h1 className="round-name">{stop.title}</h1>
        <div className="muted">
          {birds.map((b) => (
            <Link key={b.id} to={`/bird/${b.id}`} className="round-mate">
              {b.name}
            </Link>
          ))}
        </div>
        {meds.length > 0 && (
          <div className="round-meds" role="alert">
            {meds.map(({ med, left, bird }) => (
              <div key={med.id} className="round-med">
                <div className="round-med-info">
                  <strong>
                    <I n="meds" /> {bird.name}: {med.name_dose}
                  </strong>
                  <div>{med.amount}</div>
                </div>
                <button className="btn btn-primary round-med-btn" onClick={() => giveDose(med, `${bird.name}: ${med.name_dose} given`)}>
                  Given{left > 1 ? ` (${left} left)` : ''}
                </button>
              </div>
            ))}
          </div>
        )}
        {birds.map((b) => (
          <HealthAlerts key={b.id} bird={b} />
        ))}
        {has('leftovers') && <LeftoverLine birds={birds} />}
      </div>
      <div className="round-actions">
        {needsFeeding(stop.state) ? (
          <button
            className="btn btn-feed btn-xl round-fed"
            onClick={() => {
              stop.feed();
              onFed();
            }}
          >
            <span className="btn-main">FED</span>
            <span className="btn-sub">
              {stop.total} · {stop.toFeed.length === birds.length ? `all ${birds.length}` : stop.toFeed.map((b) => b.name).join(', ')}
            </span>
          </button>
        ) : (
          <div className="round-done-note">{stop.state === 'fastday' ? '✓ Fast day' : '✓ Fed'}</div>
        )}
        <div className="round-row">
          {has('leftovers') && (
            <button className="btn btn-outline btn-lg" onClick={() => setLeftOpen(true)}>
              <I n="left" /> Food left
            </button>
          )}
        </div>
      </div>
      {leftOpen && <LeftoverSheet birds={birds} title={stop.title} onClose={() => setLeftOpen(false)} />}
    </>
  );
}

/** Before the round: medication, concerns, requests and anything else to know today */
function RoundBriefing({
  title,
  order,
  statusOf,
  onStart,
  onCancel,
}: {
  title: string;
  order: Bird[];
  statusOf: (b: Bird) => ReturnType<typeof birdStatus>;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { medications, doses, today, careLogs, requests, healthIssues, healthEntries } = useStore();
  const [ready, setReady] = useState(false);
  const nameOf = (id: string | null) => order.find((b) => b.id === id)?.name ?? '';
  const meds = dosesToday(medications, doses, today).filter((x) => x.left > 0 && order.some((b) => b.id === x.med.bird_id));
  const concerns = openConcerns(careLogs).filter((c) => order.some((b) => b.id === c.bird_id));
  const birdRequests = requests.filter((r) => !r.bird_id || order.some((b) => b.id === r.bird_id));
  const photos = healthIssues.filter((i) => photoStatus(i, healthEntries, today).due && order.some((b) => b.id === i.bird_id));
  const fasting = order.filter((b) => statusOf(b).state === 'fastday');
  const nothing = !meds.length && !concerns.length && !birdRequests.length && !photos.length && !fasting.length;

  return (
    <div className="round round-briefing">
      <div className="round-top">
        <button className="btn btn-ghost round-end" onClick={onCancel}>
          ✕ Cancel
        </button>
        <span className="muted">Before you start</span>
      </div>
      <h1 className="page-title">{title}</h1>
      {nothing && <p className="muted">Nothing special today: no medication, concerns or requests.</p>}

      {meds.length > 0 && (
        <section className="panel briefing-meds">
          <h2><I n="meds" /> Medication to take with you</h2>
          <ul>
            {meds.map(({ med, left }) => (
              <li key={med.id}>
                <strong>{nameOf(med.bird_id)}</strong>: {med.name_dose} – {med.amount}
                {left > 1 && ` × ${left} today`}
                {med.notes && <em> · {med.notes}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {concerns.length > 0 && (
        <section className="panel">
          <h2><I n="concern" /> Concerns</h2>
          <ul>
            {concerns.map((c) => (
              <li key={c.id}>
                <strong>{nameOf(c.bird_id)}</strong>: {c.notes}
              </li>
            ))}
          </ul>
        </section>
      )}
      {birdRequests.length > 0 && (
        <section className="panel">
          <h2><I n="request" /> Special requests</h2>
          <ul>
            {birdRequests.map((r) => (
              <li key={r.id}>
                {r.bird_id && <strong>{nameOf(r.bird_id)}: </strong>}
                {r.instruction}
              </li>
            ))}
          </ul>
        </section>
      )}
      {photos.length > 0 && (
        <section className="panel">
          <h2><I n="photo" /> Health photos due</h2>
          <ul>
            {photos.map((i) => (
              <li key={i.id}>
                <strong>{nameOf(i.bird_id)}</strong>: {i.title}
              </li>
            ))}
          </ul>
        </section>
      )}
      {fasting.length > 0 && (
        <section className="panel">
          <h2>– Fast day today</h2>
          <p>{fasting.map((b) => b.name).join(', ')}</p>
        </section>
      )}

      {meds.length > 0 && (
        <label className="check briefing-ready">
          <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />
          <span>I've got the medication with me</span>
        </label>
      )}
      <button className="btn btn-primary btn-xl" disabled={meds.length > 0 && !ready} onClick={onStart}>
        Start round
      </button>
    </div>
  );
}
