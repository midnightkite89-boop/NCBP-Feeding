// The food menu and half-step quantities used everywhere food is chosen.

export const FOODS = ['Chick', 'Quail', 'Mice', 'Rabbit', 'Rat', 'Pheasant'] as const;
export const DEFAULT_FOOD = 'Chick';

export const QTY_STEP = 0.5;
export const QTY_MIN = 0.5;
export const QTY_MAX = 20;

/** Cuts that can be picked for the bigger foods, e.g. "Rabbit front leg + head". "whole" can't be combined. */
export const FOOD_PARTS: Record<string, readonly string[]> = {
  Rabbit: ['front leg', 'back leg', 'saddle', 'head', 'whole'],
  Pheasant: ['leg', 'wing', 'breast', 'head', 'whole'],
};

const ALIASES: Record<string, string> = { mouse: 'Mice', mice: 'Mice', chick: 'Chick', quail: 'Quail', rabbit: 'Rabbit', rat: 'Rat', pheasant: 'Pheasant' };

/** "Rabbit saddle + head" -> { base: "Rabbit", parts: ["saddle", "head"] }; null if it isn't a menu food. */
export function splitFood(food: string | null | undefined): { base: string; parts: string[] } | null {
  const t = (food ?? '').trim();
  if (!t) return null;
  const [first, ...rest] = t.split(/\s+/);
  const base = ALIASES[first.toLowerCase().replace(/s$/, '')];
  if (!base) return null;
  const tail = rest.join(' ').trim().toLowerCase();
  if (!tail) return { base, parts: [] };
  const allowed = FOOD_PARTS[base] ?? [];
  const parts = tail.split(/\s*(?:\+|,|&|\band\b)\s*/).map((x) => x.trim().replace(/s$/, '')).filter(Boolean);
  return parts.length && parts.every((x) => allowed.includes(x)) ? { base, parts } : null;
}

/** ("Rabbit", ["saddle", "head"]) -> "Rabbit saddle + head", parts kept in menu order */
export function joinFood(base: string, parts: string[]): string {
  const order = FOOD_PARTS[base] ?? [];
  const sorted = [...parts].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.length ? `${base} ${sorted.join(' + ')}` : base;
}

/** Matches typed food to the menu ("mouse" -> "Mice", "rabbit Saddle" -> "Rabbit saddle"); anything else is kept as typed. */
export function normaliseFood(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const f = splitFood(t);
  return f ? joinFood(f.base, f.parts) : t;
}

/** True for a menu food, with or without cuts ("Rabbit", "Rabbit front leg") */
export function isMenuFood(food: string | null | undefined): boolean {
  const f = splitFood(food);
  return !!f && (FOODS as readonly string[]).includes(f.base) && joinFood(f.base, f.parts) === food;
}

/** 1.5 -> "1½", 0.5 -> "½", 2 -> "2" */
export function formatQty(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (whole === 0) return half ? '½' : '0';
  return `${whole}${half ? '½' : ''}`;
}

/**
 * Reads a written quantity: "1½", "1 1/2", "1.5", "½", "2 ×", "2x".
 * Returns null if it isn't a plain number of items.
 */
export function parseQty(text: string | null | undefined): number | null {
  let t = (text ?? '').trim().toLowerCase().replace(/\s*[×x]$/, '').trim();
  if (!t) return null;
  t = t.replace('½', ' 1/2').trim();
  const m = t.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const n = Number(m[1] ?? 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  if (!(n > 0)) return null;
  return Math.round(n / QTY_STEP) * QTY_STEP || QTY_STEP;
}

/** e.g. "1½ Chick" */
export function feedLabel(qty: string | null, food: string | null): string {
  return [qty, food].filter(Boolean).join(' ');
}

/**
 * Splits an amount into number + food, e.g. ("1½", "Chick") or a combined
 * top-up like "1 Chick" -> qty 1, food "Chick". Returns null if there's no
 * plain number to work with (e.g. "half leg").
 */
export function splitAmount(amount: string | null, food: string | null): { qty: number; food: string | null } | null {
  const a = (amount ?? '').trim();
  if (!a) return null;
  // Several foods in one feed ("1 Rabbit front leg, 2 Chick") aren't one amount
  if (!food && MIXED.test(a)) return null;
  if (food) {
    const qty = parseQty(a);
    return qty == null ? null : { qty, food };
  }
  const m = a.match(/^([\d.½/\s]+?)\s+(\D.*)$/);
  if (m) {
    const qty = parseQty(m[1]);
    return qty == null ? null : { qty, food: m[2].trim() };
  }
  const qty = parseQty(a);
  return qty == null ? null : { qty, food: null };
}

/** One food in a feed, e.g. { food: "Rabbit front leg", qty: 1 } */
export interface FeedItem {
  food: string;
  qty: number;
}

const MIXED = /,\s*[\d½]/;

/** What to store for a feed: one food as food + amount, several as "1 Rabbit front leg, 2 Chick" */
export function joinFeedItems(items: FeedItem[]): { food_type: string | null; amount: string } {
  const clean = items.filter((i) => i.food.trim());
  if (clean.length === 1) return { food_type: clean[0].food.trim(), amount: formatQty(clean[0].qty) };
  return { food_type: null, amount: clean.map((i) => feedLabel(formatQty(i.qty), i.food.trim())).join(', ') };
}

/** The foods in a logged or planned feed; null if it's free text like "half leg" */
export function splitFeedItems(amount: string | null, food: string | null): FeedItem[] | null {
  const a = (amount ?? '').trim();
  if (!food && MIXED.test(a)) {
    const items = a.split(/,\s*(?=[\d½])/).map((part) => splitAmount(part, null));
    return items.every((i) => i?.food) ? items.map((i) => ({ food: i!.food!, qty: i!.qty })) : null;
  }
  const one = splitAmount(amount, food);
  return one ? [{ food: one.food ?? '', qty: one.qty }] : null;
}

/** A feed's amount moved by a number of half steps, kept between ½ and the maximum */
export function nudgeAmount(amount: string | null, food: string | null, halves: number): { amount: string; food: string | null; qty: number } | null {
  const parts = splitAmount(amount, food);
  if (!parts) return null;
  const qty = Math.min(QTY_MAX, Math.max(QTY_MIN, parts.qty + halves * QTY_STEP));
  return { amount: formatQty(qty), food: parts.food, qty };
}
