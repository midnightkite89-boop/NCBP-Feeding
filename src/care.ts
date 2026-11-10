// Cleaning and check status: what's done, due and overdue.
import type { Aviary, CareLog, CareSettings, CleanPlanRow } from './types';

export type CleanState = 'ok' | 'due' | 'overdue' | 'never';

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
}

export function isDailySection(section: string, settings: CareSettings): boolean {
  return settings.daily_sections.some((s) => s.trim().toLowerCase() === section.trim().toLowerCase());
}

/** Latest clean of an aviary (any kind of clean counts) */
export function lastAviaryClean(aviaryId: string, logs: CareLog[]): CareLog | null {
  let best: CareLog | null = null;
  for (const l of logs) if (l.kind === 'aviary_clean' && l.aviary_id === aviaryId && (!best || l.logged_at > best.logged_at)) best = l;
  return best;
}

/** The section's own timings, if set */
export function sectionRule(section: string, settings: CareSettings): { due: number; overdue: number } | null {
  const key = Object.keys(settings.section_rules ?? {}).find((k) => k.toLowerCase() === section.toLowerCase());
  return key ? settings.section_rules[key] : null;
}

/** Days until an aviary is due / overdue: its own numbers, else its section's, else the defaults */
export function cleanRule(aviary: Aviary, settings: CareSettings): { due: number; overdue: number } {
  const section = sectionRule(aviary.name, settings);
  return {
    due: aviary.clean_due_days ?? section?.due ?? settings.clean_due_days,
    overdue: aviary.clean_overdue_days ?? section?.overdue ?? settings.clean_overdue_days,
  };
}

export function aviaryCleanState(aviary: Aviary, logs: CareLog[], today: string, settings: CareSettings): { state: CleanState; last: CareLog | null; days: number | null } {
  const last = lastAviaryClean(aviary.id, logs);
  if (!last) return { state: 'never', last, days: null };
  const days = daysBetween(last.log_date, today);
  const rule = cleanRule(aviary, settings);
  const state = days >= rule.overdue ? 'overdue' : days >= rule.due ? 'due' : 'ok';
  return { state, last, days };
}

// ---------------------------------------------------------------------------
// Baths: checked every bath_check_days, cleaned every bath_clean_days.
// An aviary or section clean that ticked "Bath" counts as both; a bath clean
// counts as a check. Due on the day, overdue the day after.
// ---------------------------------------------------------------------------

export interface BathStatus {
  check: { state: CleanState; last: CareLog | null; days: number | null };
  clean: { state: CleanState; last: CareLog | null; days: number | null };
}

function latest(logs: CareLog[], match: (l: CareLog) => boolean): CareLog | null {
  let best: CareLog | null = null;
  for (const l of logs) if (match(l) && (!best || l.logged_at > best.logged_at)) best = l;
  return best;
}

function stateFor(last: CareLog | null, every: number, today: string): { state: CleanState; last: CareLog | null; days: number | null } {
  if (!last) return { state: 'never', last, days: null };
  const days = daysBetween(last.log_date, today);
  return { state: days >= every + 1 ? 'overdue' : days >= every ? 'due' : 'ok', last, days };
}

/** null when the aviary has no bath */
export function bathStatus(aviary: Aviary, logs: CareLog[], today: string, settings: CareSettings): BathStatus | null {
  if (aviary.has_bath === false) return null;
  const section = aviary.name.toLowerCase();
  const cleanedBath = (l: CareLog) =>
    (l.kind === 'bath_clean' && l.aviary_id === aviary.id) ||
    (l.kind === 'aviary_clean' && l.aviary_id === aviary.id && l.tasks.includes('bath')) ||
    (l.kind === 'section_clean' && l.section?.toLowerCase() === section && l.tasks.includes('bath'));
  const clean = latest(logs, cleanedBath);
  const check = latest(logs, (l) => cleanedBath(l) || (l.kind === 'bath_check' && l.aviary_id === aviary.id));
  return { check: stateFor(check, settings.bath_check_days, today), clean: stateFor(clean, settings.bath_clean_days, today) };
}

/** What a bath needs: 'clean' wins over 'check'; null if nothing yet */
export function bathNeeds(b: BathStatus | null): 'clean' | 'check' | null {
  if (!b) return null;
  if (b.clean.state === 'due' || b.clean.state === 'overdue' || b.clean.state === 'never') return 'clean';
  if (b.check.state !== 'ok') return 'check';
  return null;
}

// ---------------------------------------------------------------------------
// Today's cleaning list: the rota's sections for the weekday plus aviaries
// people added, minus any taken off. The latest row for an aviary wins.
// ---------------------------------------------------------------------------

export function rotaSections(weekday: number, settings: CareSettings): string[] {
  return settings.rota?.[String(weekday)] ?? [];
}

export function planAviaryIds(date: string, rows: CleanPlanRow[], rotaIds: string[]): { ids: string[]; fromRota: Set<string> } {
  const lastRow = new Map<string, CleanPlanRow>();
  const at = (r: CleanPlanRow) => r.removed_at ?? r.added_at;
  for (const r of rows) {
    if (r.plan_date !== date) continue;
    const prev = lastRow.get(r.aviary_id);
    if (!prev || at(r) >= at(prev)) lastRow.set(r.aviary_id, r);
  }
  const ids: string[] = [];
  const fromRota = new Set<string>();
  for (const id of rotaIds) {
    const r = lastRow.get(id);
    if (!r || !r.removed_at) {
      ids.push(id);
      if (!r) fromRota.add(id);
    }
  }
  const added = [...lastRow.values()].filter((r) => !r.removed_at && !ids.includes(r.aviary_id)).sort((a, b) => a.added_at.localeCompare(b.added_at));
  for (const r of added) ids.push(r.aviary_id);
  return { ids, fromRota };
}

/** Most in need first: overdue, never logged, due, then longest since cleaned */
export function suggestOrder(a: { state: CleanState; days: number | null }, b: { state: CleanState; days: number | null }): number {
  const rank: Record<CleanState, number> = { overdue: 0, never: 1, due: 2, ok: 3 };
  return rank[a.state] - rank[b.state] || (b.days ?? 999) - (a.days ?? 999);
}

/** Today's clean of a daily section (e.g. Mews), if done */
export function sectionCleanToday(section: string, logs: CareLog[], today: string): CareLog | null {
  return logs.filter((l) => l.kind === 'section_clean' && l.log_date === today && l.section?.toLowerCase() === section.toLowerCase()).at(-1) ?? null;
}

export function birdCheckToday(birdId: string, logs: CareLog[], today: string): CareLog | null {
  return logs.filter((l) => l.kind === 'bird_check' && l.bird_id === birdId && l.log_date === today).at(-1) ?? null;
}

export function openConcerns(logs: CareLog[]): CareLog[] {
  return logs.filter((l) => l.kind === 'bird_check' && l.concern && !l.resolved_at).sort((a, b) => b.logged_at.localeCompare(a.logged_at));
}

/** Winter runs from winter_start to winter_end (MM-DD), possibly across the new year */
export function isWinter(today: string, settings: CareSettings): boolean {
  const md = today.slice(5);
  const { winter_start: s, winter_end: e } = settings;
  return s <= e ? md >= s && md <= e : md >= s || md <= e;
}

/** Latest baths in/out action today: 'in' = taken in for the night, 'out' = back out */
export function bathsToday(logs: CareLog[], today: string): { state: 'in' | 'out' | null; last: CareLog | null } {
  const last = logs.filter((l) => (l.kind === 'baths_in' || l.kind === 'baths_out') && l.log_date === today).at(-1) ?? null;
  return { state: last ? (last.kind === 'baths_in' ? 'in' : 'out') : null, last };
}

export const CLEAN_LABEL: Record<CleanState, string> = { ok: 'Clean', due: 'Due', overdue: 'Overdue', never: 'Not logged' };

export function agoText(days: number | null): string {
  if (days == null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
