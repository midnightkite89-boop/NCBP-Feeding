// Turns rows from the bird CSV into a list of planned changes. Pure logic, no
// database calls, so it can be previewed before anything is saved.

import type { Aviary, Bird } from '../types';
import { parseWeight, type WeightUnit } from '../weight.ts';
import { aviaryKey } from '../aviary.ts';
import { formatQty, normaliseFood, parseQty } from '../food.ts';

export const CSV_COLUMNS = [
  'name',
  'species',
  'sex',
  'aviary',
  'aviary_number',
  'default_food',
  'default_portion',
  'feeds_per_day',
  'fast_days',
  'weight_unit',
  'target_min',
  'target_max',
  'care_notes',
  'status',
] as const;

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type BirdFields = Partial<Omit<Bird, 'id' | 'aviary_id' | 'photo_path'>>;

export interface PlannedRow {
  line: number;
  name: string;
  action: 'add' | 'update' | 'error';
  errors: string[];
  existingId?: string;
  fields: BirdFields;
  /** Aviary section as written in the CSV (created if new, together with the number) */
  aviaryName?: string;
  aviaryNumber?: number | null;
  /** Unit the targets were written in */
  unit: WeightUnit;
}

export interface Plan {
  rows: PlannedRow[];
  newAviaries: { name: string; number: number | null }[];
}

/** Accepts headings in any case, with spaces or underscores, e.g. "Default Food". */
function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/\(g\)/, 'g').replace(/_+$/, '');
}

export function parseFastDays(value: string): number[] | string {
  const v = value.trim().toLowerCase();
  if (!v || v === 'none' || v === '-') return [];
  const days = new Set<number>();
  for (const part of v.split(/[;,/\s]+/).filter(Boolean)) {
    const i = DAY_NAMES.indexOf(part.slice(0, 3));
    if (i === -1) return `unknown fast day "${part}"`;
    days.add(i + 1);
  }
  return [...days].sort();
}

export function parseUnit(value: string): WeightUnit | null {
  const v = value.trim().toLowerCase().replace(/[\s/_-]+/g, '');
  if (['g', 'gram', 'grams'].includes(v)) return 'g';
  if (['lb', 'lbs', 'oz', 'lboz', 'lbsoz', 'imperial', 'poundsounces'].includes(v)) return 'lb_oz';
  return null;
}

export function planImport(records: Record<string, string>[], birds: Bird[], aviaries: Aviary[]): Plan {
  const byName = new Map(birds.map((b) => [b.name.toLowerCase(), b]));
  const aviaryKeys = new Set(aviaries.map((a) => aviaryKey(a.name, a.number)));
  const newAviaries = new Map<string, { name: string; number: number | null }>();
  const seen = new Set<string>();

  const rows = records.map((raw, i): PlannedRow => {
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) rec[normaliseKey(k)] = (v ?? '').toString().trim();
    const get = (...keys: string[]) => keys.map((k) => rec[k]).find((v) => v != null && v !== '') ?? '';

    const name = get('name', 'bird_name', 'bird');
    const errors: string[] = [];
    const fields: BirdFields = {};
    if (!name) errors.push('missing name');
    else if (seen.has(name.toLowerCase())) errors.push('name appears twice in the file');
    seen.add(name.toLowerCase());

    const species = get('species', 'common_species');
    if (species) fields.species = species;

    const sex = get('sex').toUpperCase();
    if (sex) {
      const s = sex.startsWith('M') ? 'M' : sex.startsWith('F') ? 'F' : sex.startsWith('U') || sex === '?' ? 'U' : null;
      if (s) fields.sex = s;
      else errors.push(`sex "${sex}" should be M, F or U`);
    }

    const food = normaliseFood(get('default_food', 'food'));
    if (food) fields.default_food = food;
    const portion = get('default_portion', 'portion', 'amount');
    if (portion) {
      const q = parseQty(portion);
      fields.default_portion = q != null ? formatQty(q) : portion;
    }
    const notes = get('care_notes', 'notes');
    if (notes) fields.care_notes = notes;

    const fpd = get('feeds_per_day');
    if (fpd) {
      const n = Number(fpd);
      if (Number.isInteger(n) && n >= 1 && n <= 6) fields.feeds_per_day = n;
      else errors.push(`feeds_per_day "${fpd}" should be 1–6`);
    }

    const fast = get('fast_days');
    if (fast) {
      const parsed = parseFastDays(fast);
      if (typeof parsed === 'string') errors.push(parsed);
      else fields.fast_days = parsed;
    }

    const existing = name ? byName.get(name.toLowerCase()) : undefined;
    const unitRaw = get('weight_unit', 'unit', 'weighed_in');
    let unit: WeightUnit = existing?.weight_unit ?? 'g';
    if (unitRaw) {
      const u = parseUnit(unitRaw);
      if (u) unit = fields.weight_unit = u;
      else errors.push(`weight_unit "${unitRaw}" should be g or lb/oz`);
    }
    // Targets are written in the bird's unit, e.g. 650 or 2lb 3oz
    for (const [col, key] of [
      ['target_min', 'target_weight_min'],
      ['target_max', 'target_weight_max'],
    ] as const) {
      const v = get(col, `${col}_g`);
      if (!v) continue;
      const g = parseWeight(v, unit);
      if (typeof g === 'string') errors.push(`${col}: ${g}`);
      else fields[key] = g;
    }
    if (fields.target_weight_min != null && fields.target_weight_max != null && fields.target_weight_min > fields.target_weight_max)
      errors.push('target min is bigger than target max');

    const status = get('status').toLowerCase();
    if (status) {
      if (status === 'active') fields.status = 'active';
      else if (['archived', 'dead', 'deceased', 'gone', 'sold', 'inactive'].includes(status)) fields.status = 'archived';
      else errors.push(`status "${status}" should be active or archived`);
    }

    const aviaryName = get('aviary', 'section', 'aviary_name', 'aviary_section') || undefined;
    let aviaryNumber: number | null | undefined;
    const numRaw = get('aviary_number', 'aviary_no');
    if (numRaw) {
      const n = Number(numRaw);
      if (Number.isInteger(n)) aviaryNumber = n;
      else errors.push(`aviary_number "${numRaw}" should be a whole number`);
    }
    if (!aviaryName && aviaryNumber != null) errors.push('aviary_number given without an aviary section');
    const key = aviaryName ? aviaryKey(aviaryName, aviaryNumber) : null;
    if (key && !aviaryKeys.has(key) && !newAviaries.has(key)) newAviaries.set(key, { name: aviaryName!, number: aviaryNumber ?? null });

    return {
      line: i + 2,
      name,
      action: errors.length ? 'error' : existing ? 'update' : 'add',
      errors,
      existingId: existing?.id,
      fields,
      aviaryName,
      aviaryNumber,
      unit,
    };
  });

  return { rows, newAviaries: [...newAviaries.values()] };
}
