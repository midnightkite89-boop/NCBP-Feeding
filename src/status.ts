import type { LogInput } from './store';
import type { Bird, FeedLog } from './types';
import { isoWeekday } from './time';
import { formatWeight } from './weight';
import { DEFAULT_FOOD, feedLabel, formatQty, normaliseFood, parseQty, splitFeedItems } from './food';

/**
 * todo    = not fed yet (red)
 * part    = fed, but more food is due later today (amber) – still counts as "to feed"
 * fed     = done for today (green)
 * fastday = scheduled fast day, nothing logged (grey)
 * fasting = someone logged "fasting today" (grey)
 */
export type BirdState = 'todo' | 'part' | 'fed' | 'fastday' | 'fasting';

export interface BirdStatus {
  state: BirdState;
  fedCount: number;
  /** Most recent feeding-related log today (ignores weight-only logs) */
  last: FeedLog | null;
  /** Most recent weight recorded today */
  weight: number | null;
  /** What's still to give today, if someone said (e.g. "1 chick") */
  stillToGive: string | null;
  /** Today's food set at weigh-in, while the bird hasn't been fed since */
  planned: { food: string | null; amount: string | null; label: string } | null;
  /** Today's weigh-in log, if the bird has been weighed today */
  weighIn: FeedLog | null;
  /** Today's flights, oldest first */
  flights: FeedLog[];
}

/** `logs` must be this bird's non-voided logs for today, oldest first. */
export function birdStatus(bird: Bird, logs: FeedLog[], today: string): BirdStatus {
  // Only feeding decisions count towards fed / to feed
  const feedLogs = logs.filter((l) => l.status === 'fed' || l.status === 'fasting');
  const flights = logs.filter((l) => l.status === 'flown');
  const last = feedLogs.at(-1) ?? null;
  const fedCount = feedLogs.filter((l) => l.status === 'fed').length;
  const weight = [...logs].reverse().find((l) => l.weight_g != null)?.weight_g ?? null;

  let state: BirdState;
  if (last?.status === 'fasting') state = 'fasting';
  else if (!last) state = isFastDay(bird, today) ? 'fastday' : 'todo';
  else state = last.more_due ? 'part' : 'fed';

  // Today's food can be set at weigh-in or with "Set food". It applies until the bird is next fed.
  const weighIns = logs.filter((l) => l.weight_g != null);
  const weighIn = weighIns.at(-1) ?? null;
  const planLog = logs.filter((l) => l.status === 'weighed' && (l.food_type || l.amount)).at(-1) ?? null;
  const lastFed = feedLogs.filter((l) => l.status === 'fed').at(-1) ?? null;
  const planned =
    planLog && (!lastFed || planLog.logged_at > lastFed.logged_at)
      ? { food: planLog.food_type, amount: planLog.amount, label: feedLabel(planLog.amount, planLog.food_type) }
      : null;
  // Food set after a part-feed replaces the "still to give" amount
  const stillToGive = state === 'part' && !planned ? (last?.more_due_amount ?? null) : null;

  return { state, fedCount, last, weight, stillToGive, planned, weighIn, flights };
}

export function isFastDay(bird: Bird, date: string): boolean {
  return bird.fast_days.includes(isoWeekday(date));
}

export function needsFeeding(state: BirdState): boolean {
  return state === 'todo' || state === 'part';
}

export const STATE_LABEL: Record<BirdState, string> = {
  todo: 'To feed',
  part: 'More due',
  fed: 'Fed',
  fastday: 'Fast day',
  fasting: 'Fasting',
};

export const STATE_ICON: Record<BirdState, string> = {
  todo: '!',
  part: '½',
  fed: '✓',
  fastday: '–',
  fasting: '–',
};

/** Short description of the bird's default feed, e.g. "2 × chick" */
export function defaultFeedLabel(bird: Bird): string {
  const d = defaultFeed(bird);
  return feedLabel(d.amount, d.food);
}

/** The bird's usual food and amount; Chick and 1 when not set. */
export function defaultFeed(bird: Bird): { food: string; qty: number; amount: string } {
  // Several foods as the usual feed, e.g. "20 Chick, ½ Rabbit" with no single food
  const mixed = !bird.default_food?.trim() ? splitFeedItems(bird.default_portion, null) : null;
  if (mixed && mixed.length > 1) return { food: '', qty: 1, amount: bird.default_portion!.trim() };
  const qty = parseQty(bird.default_portion);
  return {
    food: normaliseFood(bird.default_food) ?? DEFAULT_FOOD,
    qty: qty ?? 1,
    // Keep an unusual written portion (e.g. "half leg") exactly as entered
    amount: qty != null ? formatQty(qty) : (bird.default_portion?.trim() || '1'),
  };
}

export function weightWarning(bird: Bird, weight: number | null): string | null {
  if (weight == null) return null;
  if (bird.target_weight_min != null && weight < bird.target_weight_min)
    return `Below target (min ${formatWeight(bird.target_weight_min, bird.weight_unit)})`;
  if (bird.target_weight_max != null && weight > bird.target_weight_max)
    return `Above target (max ${formatWeight(bird.target_weight_max, bird.weight_unit)})`;
  return null;
}

/** e.g. "650 g – 720 g" or "2 lb 3 oz – 2 lb 6 oz", or null if no target set */
export function targetRange(bird: Bird): string | null {
  if (bird.target_weight_min == null && bird.target_weight_max == null) return null;
  const f = (g: number | null) => (g == null ? '?' : formatWeight(g, bird.weight_unit));
  return `${f(bird.target_weight_min)} – ${f(bird.target_weight_max)}`;
}

/**
 * The one-tap FED log for a bird, in order of priority: a noted top-up
 * ("still to give"), today's food set at weigh-in, then the bird's usual feed.
 */
export function quickFeedEntry(bird: Bird, status: BirdStatus): LogInput {
  const rest = status.stillToGive;
  const today = todaysFeed(bird, status);
  return {
    bird_id: bird.id,
    status: 'fed',
    food_type: rest ? null : today.food || null,
    amount: rest ?? today.amount,
    weight_g: null,
    notes: null,
    // A noted top-up finishes the day; otherwise count feeds against feeds_per_day
    more_due: rest ? false : status.fedCount + 1 < bird.feeds_per_day,
  };
}

export function quickFeedLabel(bird: Bird, status: BirdStatus): string {
  if (status.stillToGive) return status.stillToGive;
  const t = todaysFeed(bird, status);
  return feedLabel(t.amount, t.food);
}

/** Today's food: what was set at weigh-in, otherwise the bird's usual feed. */
export function todaysFeed(bird: Bird, status: Pick<BirdStatus, 'planned'>): { food: string; qty: number; amount: string } {
  const usual = defaultFeed(bird);
  const p = status.planned;
  if (!p) return usual;
  const qty = parseQty(p.amount);
  return { food: p.food ?? usual.food, qty: qty ?? usual.qty, amount: p.amount ?? usual.amount };
}
