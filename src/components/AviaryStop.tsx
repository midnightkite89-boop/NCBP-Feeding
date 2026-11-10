import { I } from './Icon';
import { useState } from 'react';
import { aviaryLabel } from '../aviary';
import { has } from '../centre';
import { sumFeeds } from '../food';
import { leftoverTrend } from '../leftovers';
import { birdStatus, needsFeeding, quickFeedEntry, type BirdState } from '../status';
import { useStore } from '../store';
import { formatTime } from '../time';
import type { Bird } from '../types';
import { BirdRow } from './BirdCard';
import { LeftoverLine, LeftoverSheet } from './Leftovers';

/** A shared aviary's feed today: who still needs feeding, the total, and one FED for all of them. */
export function useAviaryStop(birds: Bird[]) {
  const { todayLogs, today, aviaries, logFeeds, leftovers } = useStore();
  const aviary = aviaries.find((a) => a.id === birds[0].aviary_id);
  const title = aviary ? aviaryLabel(aviary) : birds[0].name;
  const statuses = birds.map((b) => ({ bird: b, status: birdStatus(b, todayLogs.filter((l) => l.bird_id === b.id), today) }));
  const toFeed = statuses.filter((s) => needsFeeding(s.status.state));
  const entries = toFeed.map((s) => quickFeedEntry(s.bird, s.status));
  const total = sumFeeds(entries);
  let state: BirdState;
  if (toFeed.length === 0) state = statuses.every((s) => s.status.state === 'fastday' || s.status.state === 'fasting') ? 'fastday' : 'fed';
  else state = toFeed.length < birds.length ? 'part' : 'todo';
  const lastFed = statuses
    .map((s) => s.status.last)
    .filter((l) => l?.status === 'fed')
    .sort((a, b) => a!.logged_at.localeCompare(b!.logged_at))
    .at(-1);
  const leavingFood = has('leftovers') && leftoverTrend(birds.map((b) => b.id), leftovers, today).flagged;
  return {
    title,
    state,
    total,
    toFeed: toFeed.map((s) => s.bird),
    lastFed,
    leavingFood,
    feed: () => logFeeds(entries, `${title} fed – ${total}`, { alsoCheck: true }),
  };
}

/** e.g. "3 Steller's sea eagles" or "Bruce, Azura" */
export function birdsLabel(birds: Bird[]): string {
  const species = new Set(birds.map((b) => b.species));
  // Birds without a real name were called after their species ("Mottled owl 2")
  const named = birds.filter((b) => b.name !== b.species && !(b.species && b.name.startsWith(`${b.species} `)));
  if (named.length === birds.length) return birds.map((b) => b.name).join(', ');
  if (named.length > 0) return `${named.map((b) => b.name).join(', ')} + ${birds.length - named.length}`;
  if (species.size === 1) return `${birds.length} ${plural(birds[0].species ?? 'bird')}`;
  return `${birds.length} birds`;
}

const plural = (s: string) => (s.endsWith('s') ? s : `${s}s`);

/** Compact row for a shared aviary on Today: one FED for every bird in it. Tap to open. */
export function AviaryRow({ birds }: { birds: Bird[] }) {
  const [open, setOpen] = useState(false);
  const stop = useAviaryStop(birds);
  const right = needsFeeding(stop.state) ? (
    <button
      className="row-fed"
      onClick={(e) => {
        e.stopPropagation();
        stop.feed();
      }}
      aria-label={`${stop.title} fed: ${stop.total}`}
    >
      FED
    </button>
  ) : stop.state === 'fastday' ? (
    <span className="row-status muted">Fast day</span>
  ) : (
    <span className="row-status ok">Fed {stop.lastFed ? formatTime(stop.lastFed.logged_at) : ''}</span>
  );

  return (
    <div className={`bird-row-wrap${open ? ' open' : ''}`}>
      <div
        className={`bird-row state-${stop.state}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}
      >
        <span className="row-dot" aria-hidden="true" />
        <span className="row-name">
          {birdsLabel(birds)} <span className="row-shared">· shared</span>
        </span>
        {birds[0].aviary_id && <AviaryNumber birds={birds} />}
        {stop.leavingFood && <span className="row-flag flag-left" aria-label="Keeps leaving food"><I n="left" size={17} /></span>}
        <span className="row-right">{right}</span>
      </div>
      {open && <AviaryCard birds={birds} />}
    </div>
  );
}

function AviaryNumber({ birds }: { birds: Bird[] }) {
  const { aviaries } = useStore();
  const n = aviaries.find((a) => a.id === birds[0].aviary_id)?.number;
  return n != null ? <span className="row-num">{n}</span> : null;
}

/** The whole aviary: total feed, FED for all, food left; each bird below for anything individual. */
export function AviaryCard({ birds }: { birds: Bird[] }) {
  const stop = useAviaryStop(birds);
  const [leftOpen, setLeftOpen] = useState(false);
  return (
    <article className={`bird-card aviary-card state-${stop.state}`}>
      <div className="bird-title">
        <div className="bird-name">{stop.title}</div>
        <div className="species">Fed together: {birds.map((b) => b.name).join(', ')}</div>
      </div>
      {has('leftovers') && <LeftoverLine birds={birds} />}
      <div className="card-actions">
        {needsFeeding(stop.state) && (
          <button className="btn btn-feed btn-xl" onClick={stop.feed}>
            <span className="btn-main">FED</span>
            <span className="btn-sub">
              {stop.total}
              {stop.toFeed.length < birds.length && ` (${stop.toFeed.map((b) => b.name).join(', ')})`}
            </span>
          </button>
        )}
        <div className="card-actions-row">
          {has('leftovers') && (
            <button className="btn btn-outline btn-lg" onClick={() => setLeftOpen(true)}>
              <I n="left" /> Food left
            </button>
          )}
        </div>
      </div>
      <details className="aviary-birds">
        <summary>Each bird (weights, concerns, medication)</summary>
        {birds.map((b) => (
          <BirdRow key={b.id} bird={b} />
        ))}
      </details>
      {leftOpen && <LeftoverSheet birds={birds} title={stop.title} onClose={() => setLeftOpen(false)} />}
    </article>
  );
}
