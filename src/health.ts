// Medication schedules and photo reminders.
import { daysBetween } from './care';
import type { HealthEntry, HealthIssue, MedDose, Medication } from './types';

/** Is this medication given on this date? (between start and end, on its every-N-days rhythm, not stopped) */
export function medDueOn(med: Medication, date: string): boolean {
  if (med.voided_at) return false;
  if (date < med.start_date || (med.end_date && date > med.end_date)) return false;
  if (med.stopped_at && date > med.stopped_at.slice(0, 10)) return false;
  return daysBetween(med.start_date, date) % med.every_days === 0;
}

/** Doses still to give today for each medication, e.g. [{ med, given: 0, due: 2 }] */
export function dosesToday(meds: Medication[], doses: MedDose[], today: string) {
  return meds
    .filter((m) => !m.stopped_at && medDueOn(m, today))
    .map((med) => {
      const given = doses.filter((d) => d.medication_id === med.id && d.dose_date === today && !d.voided_at);
      return { med, given, left: Math.max(0, med.times_per_day - given.length) };
    });
}

/** "1 × a day", "2 × a day, every other day" */
export function scheduleText(med: Pick<Medication, 'times_per_day' | 'every_days'>): string {
  const per = `${med.times_per_day} × a day`;
  if (med.every_days === 1) return per;
  if (med.every_days === 2) return `${per}, every other day`;
  return `${per}, every ${med.every_days} days`;
}

/** "14 Oct – 20 Oct (7 days)" or "from 14 Oct" */
export function courseDays(med: Medication): number | null {
  return med.end_date ? daysBetween(med.start_date, med.end_date) + 1 : null;
}

/** Last photo for an issue, and whether a new one is due */
export function photoStatus(issue: HealthIssue, entries: HealthEntry[], today: string): { last: string | null; due: boolean; days: number | null } {
  const withPhotos = entries.filter((e) => e.issue_id === issue.id && e.photo_paths.length > 0 && !e.voided_at);
  const last = withPhotos.reduce<string | null>((acc, e) => (!acc || e.log_date > acc ? e.log_date : acc), null);
  const days = last ? daysBetween(last, today) : null;
  const due = !!issue.photo_every_days && !issue.closed_at && (days == null || days >= issue.photo_every_days);
  return { last, due, days };
}

/** Shrink a phone photo to at most 1600 px on the long side, as JPEG (~300 KB) */
export async function shrinkPhoto(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that photo'))), 'image/jpeg', 0.82));
}
