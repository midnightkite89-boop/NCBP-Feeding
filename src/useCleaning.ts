import { useMemo } from 'react';
import { compareAviaries, routeSort, sectionsInRouteOrder } from './aviary';
import {
  aviaryCleanState,
  bathNeeds,
  bathStatus,
  isDailySection,
  planAviaryIds,
  rotaSections,
  sectionCleanToday,
  suggestOrder,
  type BathStatus,
  type CleanState,
} from './care';
import { useStore } from './store';
import { isoWeekday } from './time';
import type { Aviary, Bird, CareLog } from './types';

export interface AviaryCare {
  aviary: Aviary;
  birds: Bird[];
  clean: { state: CleanState; last: CareLog | null; days: number | null };
  bath: BathStatus | null;
  /** What the bath needs now, if anything */
  bathNeeds: 'clean' | 'check' | null;
}

export interface SectionCare {
  section: string;
  daily: boolean;
  aviaries: AviaryCare[];
}

/** After midday, anything due today counts as an alert too */
function afterMidday(): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h >= 12;
}

/** Everything the Clean tab, Today and the tab badge need to know about cleaning. */
export function useCleaning() {
  const { aviaries, birds, careLogs, careSettings, today, cleanPlan } = useStore();

  return useMemo(() => {
    const active = birds.filter((b) => b.status === 'active');
    const ordered = routeSort(active, aviaries);
    const stop = new Map<string, number>();
    ordered.forEach((b, i) => b.aviary_id && !stop.has(b.aviary_id) && stop.set(b.aviary_id, i));

    // Each section's occupied aviaries in feeding-round order
    const sections: SectionCare[] = sectionsInRouteOrder(active, aviaries).map((section) => ({
      section,
      daily: isDailySection(section, careSettings),
      aviaries: aviaries
        .filter((a) => !a.archived && a.name.toLowerCase() === section.toLowerCase() && stop.has(a.id))
        .sort((x, y) => (stop.get(x.id) ?? 0) - (stop.get(y.id) ?? 0) || compareAviaries(x, y))
        .map((aviary) => {
          const bath = bathStatus(aviary, careLogs, today, careSettings);
          return {
            aviary,
            birds: ordered.filter((b) => b.aviary_id === aviary.id),
            clean: aviaryCleanState(aviary, careLogs, today, careSettings),
            bath,
            bathNeeds: bathNeeds(bath),
          };
        }),
    }));

    const all = sections.flatMap((s) => s.aviaries);
    const weekly = sections.filter((s) => !s.daily).flatMap((s) => s.aviaries);
    const byId = new Map(all.map((x) => [x.aviary.id, x]));
    const count = (list: AviaryCare[], state: CleanState) => list.filter((x) => x.clean.state === state).length;

    const dailyLeft = sections.filter((s) => s.daily && !sectionCleanToday(s.section, careLogs, today)).map((s) => s.section);
    const bathsToCheck = all.filter((x) => x.bathNeeds === 'check');
    const bathsToClean = all.filter((x) => x.bathNeeds === 'clean');
    // Alerts ignore baths never logged, so day one doesn't light up every bath
    const bathsOverdue = all.filter((x) => x.bath && (x.bath.check.state === 'overdue' || x.bath.clean.state === 'overdue'));
    const bathsDue = all.filter((x) => x.bath && [x.bath.check.state, x.bath.clean.state].some((st) => st === 'due' || st === 'overdue'));

    // Today's list: rota sections for the weekday plus aviaries added by hand
    const rota = rotaSections(isoWeekday(today), careSettings).filter((s) => !isDailySection(s, careSettings));
    const rotaIds = weekly.filter((x) => rota.some((s) => s.toLowerCase() === x.aviary.name.toLowerCase())).map((x) => x.aviary.id);
    const plan = planAviaryIds(today, cleanPlan, rotaIds);
    const planItems = plan.ids.map((id) => byId.get(id)).filter((x): x is AviaryCare => !!x);
    const planLeft = planItems.filter((x) => x.clean.last?.log_date !== today).length;
    const suggestions = weekly
      .filter((x) => !plan.ids.includes(x.aviary.id) && x.clean.state !== 'ok')
      .sort((a, b) => suggestOrder(a.clean, b.clean))
      .slice(0, careSettings.suggest_count);

    // Alerts for the Today chip and the Clean tab badge
    const midday = afterMidday();
    const overdueAviaries = count(weekly, 'overdue');
    const alerts: string[] = [];
    if (overdueAviaries) alerts.push(`${overdueAviaries} aviar${overdueAviaries === 1 ? 'y' : 'ies'} overdue`);
    const bathAlert = midday ? bathsDue.length : bathsOverdue.length;
    if (bathAlert) alerts.push(`${bathAlert} bath${bathAlert === 1 ? '' : 's'} ${midday ? 'to do' : 'overdue'}`);
    if (midday && dailyLeft.length) alerts.push(`${dailyLeft.join(', ')} not cleaned`);
    if (midday && planLeft) alerts.push(`${planLeft} left on today's list`);
    // Quiet (the default for now): only aviaries past their overdue day. Full: one count per kind of alert.
    const level = careSettings.alert_level ?? 'quiet';
    if (level !== 'full') alerts.splice(overdueAviaries ? 1 : 0);
    if (level === 'off') alerts.length = 0;
    const alertCount = level === 'off' ? 0 : level === 'quiet' ? overdueAviaries : alerts.length;

    return {
      sections,
      overdue: overdueAviaries,
      due: count(weekly, 'due'),
      never: count(weekly, 'never'),
      dailyLeft,
      bathsToCheck,
      bathsToClean,
      rota,
      planItems,
      planFromRota: plan.fromRota,
      planLeft,
      suggestions,
      alerts,
      alertCount,
    };
  }, [aviaries, birds, careLogs, careSettings, today, cleanPlan]);
}
