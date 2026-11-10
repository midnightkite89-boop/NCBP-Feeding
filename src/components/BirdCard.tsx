import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { STATE_ICON, STATE_LABEL, birdStatus, needsFeeding, quickFeedEntry, quickFeedLabel, weightWarning, type BirdStatus } from '../status';
import { formatTime } from '../time';
import { feedLabel, nudgeAmount } from '../food';
import { formatWeight } from '../weight';
import type { Bird } from '../types';
import { BirdPhoto } from './BirdPhoto';
import { LogSheet } from './LogSheet';
import { FlyFeedSheet, TodayEntries } from './FlyFeed';
import { ConcernSheet } from './Care';
import { DosesDue } from '../pages/Health';
import { dosesToday, photoStatus } from '../health';
import { birdCheckToday, openConcerns } from '../care';
import { aviaryLabel } from '../aviary';
import { RequestList } from './RequestList';
import { RequestSheet } from './RequestSheet';
import { Sheet } from './Sheet';
import { TargetsSheet } from './TargetsSheet';
import { HealthAlerts } from './HealthAlerts';
import { LeftoverLine, LeftoverSheet } from './Leftovers';
import { has } from '../centre';
import { leftoverTrend } from '../leftovers';

type SheetName = 'more' | 'log' | 'setfood' | 'request' | 'flown' | 'concern' | 'targets' | 'left' | null;

/** Everything a card or row needs to know about a bird today */
export function useBirdToday(bird: Bird) {
  const { todayLogs, today, careLogs, requests, medications, doses, healthIssues, healthEntries, leftovers } = useStore();
  const status = birdStatus(
    bird,
    todayLogs.filter((l) => l.bird_id === bird.id),
    today,
  );
  const checked = birdCheckToday(bird.id, careLogs, today);
  const concern = openConcerns(careLogs).find((c) => c.bird_id === bird.id) ?? null;
  const birdRequests = requests.filter((r) => r.bird_id === bird.id);
  const medsLeft = dosesToday(medications.filter((m) => m.bird_id === bird.id), doses, today).reduce((n, x) => n + x.left, 0);
  const photoDue = healthIssues.some((i) => i.bird_id === bird.id && photoStatus(i, healthEntries, today).due);
  const leavingFood = has('leftovers') && leftoverTrend(bird.id, leftovers, today).flagged;
  return { status, checked, concern, birdRequests, medsLeft, photoDue, leavingFood };
}

/** One-tap FED: logs the feed and, since the bird has been seen, the daily check */
export function useQuickFeed(bird: Bird, status: BirdStatus) {
  const { logFeeds } = useStore();
  return () => logFeeds([quickFeedEntry(bird, status)], `${bird.name} fed`, { alsoCheck: true });
}

/**
 * The FED feed with − / + half steps applied (just this once; resets after feeding).
 * canNudge is false when the amount isn't a plain number, e.g. "half leg".
 */
export function useNudgedFeed(bird: Bird, status: BirdStatus) {
  const { logFeeds } = useStore();
  const [halves, setHalves] = useState(0);
  const base = quickFeedEntry(bird, status);
  const nudged = nudgeAmount(base.amount, base.food_type, halves);
  const canNudge = nudgeAmount(base.amount, base.food_type, 0) != null;
  const entry = halves !== 0 && nudged ? { ...base, amount: nudged.amount, food_type: nudged.food } : base;
  const label = halves !== 0 && nudged ? feedLabel(nudged.amount, nudged.food) : quickFeedLabel(bird, status);
  return {
    halves,
    canNudge,
    label,
    usual: quickFeedLabel(bird, status),
    canLess: !!nudgeAmount(base.amount, base.food_type, halves - 1) && nudged?.qty !== 0.5,
    less: () => setHalves((h) => h - 1),
    more: () => setHalves((h) => h + 1),
    feed: () => {
      logFeeds([entry], `${bird.name} fed – ${label}`, { alsoCheck: true });
      setHalves(0);
    },
  };
}

export function BirdCard({ bird, detailed = false }: { bird: Bird; detailed?: boolean }) {
  const { logName, aviaries, logCare } = useStore();
  const [sheet, setSheet] = useState<SheetName>(null);
  const { status, checked, concern, birdRequests } = useBirdToday(bird);
  const { state, fedCount, weight, stillToGive } = status;
  const aviary = aviaries.find((a) => a.id === bird.aviary_id);
  const warning = weightWarning(bird, weight);
  const feed = useNudgedFeed(bird, status);
  const feedsNote = bird.feeds_per_day > 1 ? ` (${fedCount} of ${bird.feeds_per_day})` : fedCount > 1 ? ` ×${fedCount}` : '';


  return (
    <article className={`bird-card state-${state}`}>
      <div className="bird-head">
        <BirdPhoto bird={bird} size={detailed ? 72 : 52} />
        <div className="bird-title">
          <Link to={`/bird/${bird.id}`} className="bird-name">
            {bird.name}
          </Link>
          <div className="species">
            {aviary && <span className="card-aviary">{aviaryLabel(aviary)}</span>}
            {bird.species}
          </div>
        </div>
        <div className={`chip chip-${state}`}>
          <span aria-hidden="true">{STATE_ICON[state]}</span> {STATE_LABEL[state]}
          {feedsNote}
        </div>
      </div>

      <TodayEntries bird={bird} />
      {warning && weight != null && (
        <p className="warn">
          {formatWeight(weight, bird.weight_unit)} – {warning}
        </p>
      )}
      {stillToGive && <p className="still-to-give">Still to give: {stillToGive}</p>}
      {!stillToGive && status.planned && needsFeeding(state) && <p className="planned-food">Today's food: {status.planned.label}</p>}
      {concern && <p className="concern-line">⚠ {concern.notes}</p>}
      {has('leftovers') && <LeftoverLine birds={[bird]} />}
      <DosesDue birdId={bird.id} compact />
      <HealthAlerts bird={bird} />
      {detailed && bird.care_notes && <p className="care-notes">{bird.care_notes}</p>}
      <RequestList requests={birdRequests} showBird={false} />

      <div className="card-actions">
        {state === 'fastday' ? (
          <div className="fast-banner">FAST DAY – do not feed</div>
        ) : needsFeeding(state) ? (
          <div className="round-fed-row card-fed-row">
            {feed.canNudge && (
              <button className="btn btn-outline qty-nudge" onClick={feed.less} disabled={!feed.canLess} aria-label="Half less">
                −
              </button>
            )}
            <button className={`btn btn-feed btn-xl round-fed${feed.halves !== 0 ? ' nudged' : ''}`} onClick={feed.feed}>
              <span className="btn-main">FED</span>
              <span className="btn-sub">
                {feed.label}
                {feed.halves !== 0 && ` (usual ${feed.usual})`}
              </span>
            </button>
            {feed.canNudge && (
              <button className="btn btn-outline qty-nudge" onClick={feed.more} aria-label="Half more">
                +
              </button>
            )}
          </div>
        ) : null}
        <div className="card-actions-row">
          {!checked && !needsFeeding(state) && (
            <button className="btn btn-outline btn-lg" onClick={() => logCare([{ kind: 'bird_check', bird_id: bird.id }], `${bird.name} checked`)}>
              ✓ Checked
            </button>
          )}
          {has('leftovers') && (
            <button className="btn btn-outline btn-lg" onClick={() => setSheet('left')}>
              🍗 Food left
            </button>
          )}
          {bird.team !== 'aviary' && (
            <button className="btn btn-outline btn-lg" onClick={() => setSheet('flown')}>
              ✈ Fly / Feed
            </button>
          )}
          <button className="btn btn-outline btn-lg" onClick={() => setSheet('more')} aria-label={`More for ${bird.name}`}>
            ⋯ More
          </button>
        </div>
      </div>
      {checked && !concern && <p className="checked-small">✓ Checked {formatTime(checked.logged_at)} {logName(checked)}</p>}

      {sheet === 'more' && (
        <Sheet title={bird.name} onClose={() => setSheet(null)}>
          <div className="more-list">
            <button onClick={() => setSheet('log')}>⚖ Weight / other food</button>
            <button onClick={() => setSheet('setfood')}>🍽 Set today's food</button>
            <button onClick={() => setSheet('targets')}>🎯 Target weight / usual amount</button>
            {!checked && (
              <button
                onClick={() => {
                  logCare([{ kind: 'bird_check', bird_id: bird.id }], `${bird.name} checked`);
                  setSheet(null);
                }}
              >
                ✓ Checked (no feed)
              </button>
            )}
            <button className="more-warn" onClick={() => setSheet('concern')}>
              ⚠ Raise a concern
            </button>
            <button onClick={() => setSheet('request')}>✎ Special request</button>
            <Link to={`/health/issue/new?bird=${bird.id}`} onClick={() => setSheet(null)}>
              🩺 Health issue / photo
            </Link>
            <Link to={`/health/med/new?bird=${bird.id}`} onClick={() => setSheet(null)}>
              💊 Add medication
            </Link>
            <Link to={`/bird/${bird.id}`} onClick={() => setSheet(null)}>
              📋 History and details
            </Link>
          </div>
        </Sheet>
      )}
      {sheet === 'log' && <LogSheet bird={bird} status={status} onClose={() => setSheet(null)} />}
      {sheet === 'setfood' && <LogSheet bird={bird} status={status} initialMode="setfood" onClose={() => setSheet(null)} />}
      {sheet === 'request' && <RequestSheet birdId={bird.id} onClose={() => setSheet(null)} />}
      {sheet === 'flown' && <FlyFeedSheet bird={bird} onClose={() => setSheet(null)} />}
      {sheet === 'concern' && <ConcernSheet bird={bird} onClose={() => setSheet(null)} />}
      {sheet === 'left' && <LeftoverSheet birds={[bird]} onClose={() => setSheet(null)} />}
      {sheet === 'targets' && <TargetsSheet bird={bird} onClose={() => setSheet(null)} />}
    </article>
  );
}

/** Compact one-line version for Today. Tap the row to open the full card. */
export function BirdRow({ bird }: { bird: Bird }) {
  const { aviaries } = useStore();
  const [open, setOpen] = useState(false);
  const { status, concern, birdRequests, medsLeft, photoDue, leavingFood } = useBirdToday(bird);
  const { state, last } = status;
  const aviary = aviaries.find((a) => a.id === bird.aviary_id);
  const quickFeed = useQuickFeed(bird, status);

  let right: React.ReactNode;
  if (needsFeeding(state)) {
    right = (
      <button
        className="row-fed"
        onClick={(e) => {
          e.stopPropagation();
          quickFeed();
        }}
        aria-label={`${bird.name} fed: ${quickFeedLabel(bird, status)}`}
      >
        FED
      </button>
    );
  } else if (state === 'fastday') {
    right = <span className="row-status muted">Fast day</span>;
  } else if (state === 'fasting') {
    right = <span className="row-status muted">Fasting</span>;
  } else {
    right = <span className="row-status ok">Fed {last ? formatTime(last.logged_at) : ''}</span>;
  }

  return (
    <div className={`bird-row-wrap${open ? ' open' : ''}`}>
      <div
        className={`bird-row state-${state}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}
      >
        <span className="row-dot" aria-hidden="true" />
        <span className="row-name">{bird.name}</span>
        {aviary?.number != null && <span className="row-num">{aviary.number}</span>}
        {(concern || birdRequests.length > 0) && (
          <span className="row-flag" title={concern ? 'Concern' : 'Special request'} aria-label={concern ? 'Concern' : 'Special request'}>
            ⚠
          </span>
        )}
        {status.flights.length > 0 && <span className="row-flag plain" aria-label="Flown today">✈</span>}
        {leavingFood && <span className="row-flag plain" aria-label="Keeps leaving food">🍗</span>}
        {medsLeft > 0 && <span className="row-flag plain" aria-label="Medication due">💊</span>}
        {photoDue && <span className="row-flag plain" aria-label="Health photo due">📷</span>}
        <span className="row-right">{right}</span>
      </div>
      {open && <BirdCard bird={bird} />}
    </div>
  );
}
