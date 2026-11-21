import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { addDays } from './time';
import type { Bird, BirdCheckup, CareSettings } from './types';

export const DEFAULT_CHECKUP_DAYS = 182;
/** Shown as "due soon" this many days ahead */
export const CHECKUP_SOON_DAYS = 30;
export const CONDITION_SCORES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** The areas on NCBP's paper health check form, in its order */
export const CHECK_ITEMS: { key: string; label: string }[] = [
  { key: 'toes', label: 'Manipulate toes' },
  { key: 'feet_under', label: 'Feet – underside' },
  { key: 'talons', label: 'Feet – talons' },
  { key: 'carpals', label: 'Carpal joints' },
  { key: 'beak_in', label: 'Beak – inside' },
  { key: 'beak_out', label: 'Beak – outside' },
  { key: 'feathers', label: 'Feather condition' },
  { key: 'wounds', label: 'Wounds' },
];

export type CheckupState = 'never' | 'overdue' | 'soon' | 'ok';

export interface CheckupStatus {
  state: CheckupState;
  last: BirdCheckup | null;
  /** When the next check is due (null if never checked) */
  dueOn: string | null;
}

/** Birds that get hands-on checks: aviary (breeding) birds and resting flying birds */
export const getsCheckups = (b: Bird) => b.status === 'active' && (b.team === 'aviary' || b.team === 'resting');

export function checkupEvery(s: CareSettings): number {
  return s.checkup_every_days && s.checkup_every_days > 0 ? s.checkup_every_days : DEFAULT_CHECKUP_DAYS;
}

/** `checkups` = non-voided checks for any birds */
export function checkupStatus(birdId: string, checkups: BirdCheckup[], today: string, every: number): CheckupStatus {
  const last = checkups.filter((c) => c.bird_id === birdId).sort((a, b) => a.checked_on.localeCompare(b.checked_on) || a.logged_at.localeCompare(b.logged_at)).at(-1) ?? null;
  if (!last) return { state: 'never', last, dueOn: null };
  const dueOn = addDays(last.checked_on, every);
  const state = dueOn <= today ? 'overdue' : dueOn <= addDays(today, CHECKUP_SOON_DAYS) ? 'soon' : 'ok';
  return { state, last, dueOn };
}

/** Scores as on the paper form: 1 to 5, with "+" for in between (3.5 = "3+") */
export function scoreLabel(n: number | null): string {
  if (n == null) return '';
  return `${Math.floor(n)}${n % 1 ? '+' : ''}`;
}

/** Areas with a note, e.g. "talons: trimmed; beak outside: coped" */
export function checkNotes(c: BirdCheckup): string {
  return CHECK_ITEMS.filter((i) => c.checks?.[i.key]?.note)
    .map((i) => `${i.label.replace(' – ', ' ').toLowerCase()}: ${c.checks![i.key].note}`)
    .join('; ');
}

export function copedLabel(c: Pick<BirdCheckup, 'coped_beak' | 'coped_talons'>): string {
  if (c.coped_beak && c.coped_talons) return 'beak and talons coped';
  if (c.coped_beak) return 'beak coped';
  if (c.coped_talons) return 'talons coped';
  return '';
}

/** All checks (they're few: about two a year per bird). Needs a signal; refetch after saving. */
export function useCheckups() {
  const [checkups, setCheckups] = useState<BirdCheckup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('bird_checkups').select('*').is('voided_at', null).order('checked_on');
    if (error) setError('Health checks need a signal to load.');
    else setError(null);
    setCheckups((data as BirdCheckup[]) ?? []);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { checkups, error, reload };
}
