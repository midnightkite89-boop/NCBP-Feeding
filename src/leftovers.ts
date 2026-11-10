import { addDays } from './time';
import { feedLabel } from './food';
import type { FeedLog } from './types';

/** Over this many days, a bird leaving food on LEFT_FLAG_DAYS of them gets flagged */
export const LEFT_WINDOW_DAYS = 7;
export const LEFT_FLAG_DAYS = 3;

export interface LeftoverTrend {
  /** Days in the last week (today included) with food left */
  days: number;
  /** Food left today and yesterday, or on LEFT_FLAG_DAYS days this week */
  flagged: boolean;
  /** The most recent leftover, if any in the window */
  last: FeedLog | null;
  /** e.g. "Left food 3 of the last 7 days" */
  text: string | null;
}

/** `leftovers` = "food left" logs, oldest first (any birds). */
export function leftoverTrend(birdId: string, leftovers: FeedLog[], today: string): LeftoverTrend {
  const from = addDays(today, -(LEFT_WINDOW_DAYS - 1));
  const mine = leftovers.filter((l) => l.bird_id === birdId && l.log_date >= from && l.log_date <= today);
  const dates = new Set(mine.map((l) => l.log_date));
  const days = dates.size;
  const twoInARow = dates.has(today) && dates.has(addDays(today, -1));
  const flagged = days >= LEFT_FLAG_DAYS || twoInARow;
  let text: string | null = null;
  if (flagged) text = twoInARow && days < LEFT_FLAG_DAYS ? 'Left food today and yesterday' : `Left food ${days} of the last ${LEFT_WINDOW_DAYS} days`;
  return { days, flagged, last: mine.at(-1) ?? null, text };
}

export function leftoverLabel(l: Pick<FeedLog, 'amount' | 'food_type'>): string {
  return l.food_type || l.amount ? feedLabel(l.amount, l.food_type) : 'some food';
}
