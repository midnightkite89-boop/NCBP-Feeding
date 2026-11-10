import { CENTRE } from './centre';
import type { WeightUnit } from './weight';

export type Role = 'admin' | 'staff';

export interface Profile {
  id: string;
  display_name: string;
  role: Role;
  /** A shared login (e.g. the shed iPad) that asks who is using it */
  shared_device?: boolean;
}

export interface Aviary {
  id: string;
  name: string;
  number: number | null;
  slug: string;
  archived: boolean;
  /** Check this aviary on frost nights */
  cold_spot?: boolean;
  cold_note?: string | null;
  /** Own cleaning timings; null = use the section's or the default */
  clean_due_days?: number | null;
  clean_overdue_days?: number | null;
  /** Has a bath to check and clean (default true) */
  has_bath?: boolean;
}

export type BirdTeam = 'flying' | 'resting' | 'aviary';

export const TEAM_LABEL: Record<BirdTeam, string> = { flying: 'Flying team', resting: 'Resting', aviary: 'Aviary bird' };

/** Weighed daily: flying-team birds that aren't resting */
export const isWeighed = (b: Pick<Bird, 'team'>) => (b.team ?? 'flying') === 'flying';

export interface Bird {
  id: string;
  name: string;
  species: string | null;
  sex: 'M' | 'F' | 'U' | null;
  photo_path: string | null;
  aviary_id: string | null;
  /** Stored in grams whatever the unit */
  target_weight_min: number | null;
  target_weight_max: number | null;
  /** How this bird is weighed and shown: grams or lb/oz */
  weight_unit: WeightUnit;
  default_food: string | null;
  default_portion: string | null;
  feeds_per_day: number;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday */
  fast_days: number[];
  care_notes: string | null;
  /** Position on the feeding round (null = end of the list) */
  route_order: number | null;
  status: 'active' | 'archived';
  /** Which feeding round the bird is on, counting from 1 */
  feed_round?: number;
  /** flying = on the team, weighed daily; resting = time off at weight; aviary = not flown or weighed */
  team?: BirdTeam;
  /** The bird's folder in the Google Drive database */
  drive_folder_url?: string | null;
  // AAL records (R1 / R2)
  scientific_name?: string | null;
  ring_microchip?: string | null;
  hatch_year?: number | null;
  a10_cert?: string | null;
  used_for?: string | null;
  supplier?: string | null;
  hatch_date?: string | null;
  arrival_date?: string | null;
  age_at_arrival?: string | null;
  neutered?: string | null;
  insured?: string | null;
  housed_alone?: string | null;
  enrichment?: string | null;
  enrichment_frequency?: string | null;
  vaccinations?: string | null;
  treatments?: string | null;
  feeding_regime?: string | null;
  exercise_regime?: string | null;
  record_notes?: string | null;
  died_on?: string | null;
  death_cause?: string | null;
  disposal_reason?: string | null;
  carcass_disposal?: string | null;
}

/** fed = food given; fasting = deliberately not fed today; weighed = weight only; flown = flight (logged_at = flight time) */
export type FlightType = 'display' | 'experience' | 'training' | 'school' | 'other';

export const FLIGHT_TYPES: { value: FlightType; label: string }[] = [
  { value: 'display', label: 'Display' },
  { value: 'experience', label: 'Experience' },
  { value: 'training', label: 'Training' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
];

export function flightTypeLabel(t: FlightType | null | undefined): string | null {
  return FLIGHT_TYPES.find((f) => f.value === t)?.label ?? null;
}

export type LogStatus = 'fed' | 'fasting' | 'weighed' | 'flown' | 'left';

export interface FeedLog {
  id: string;
  bird_id: string;
  logged_at: string;
  log_date: string;
  staff_id: string;
  /** Who was using a shared device (staff_id is then the device) */
  logged_for?: string | null;
  /** A volunteer's name, logged on a shared device */
  logged_for_name?: string | null;
  status: LogStatus;
  food_type: string | null;
  amount: string | null;
  weight_g: number | null;
  notes: string | null;
  more_due: boolean;
  /** How much more is still to give today, e.g. "1 chick" */
  more_due_amount?: string | null;
  /** For flown logs */
  flight_type?: FlightType | null;
  /** Set when logged as part of a session (several birds flown together) */
  session_id?: string | null;
  /** Set when this log corrects an earlier one */
  replaces?: string | null;
  voided_by: string | null;
  voided_at: string | null;
  /** Saved on this phone but not yet sent to the server */
  pending?: boolean;
}

export interface SpecialRequest {
  id: string;
  bird_id: string | null;
  instruction: string;
  created_by: string;
  created_at: string;
  expires_on: string | null;
  cleared_by: string | null;
  cleared_at: string | null;
  pending?: boolean;
}

// ---------------------------------------------------------------------------
// Cleaning, daily checks, winter baths
// ---------------------------------------------------------------------------

export type CareKind = 'aviary_clean' | 'section_clean' | 'bird_check' | 'baths_in' | 'baths_out' | 'bath_check' | 'bath_clean';

export const CLEAN_TASKS = [
  { value: 'bath', label: 'Bath' },
  { value: 'spot', label: 'Spot clean' },
  { value: 'astroturf', label: 'Astroturf' },
  { value: 'deep', label: 'Deep clean' },
  { value: 'disinfect', label: 'Disinfected' },
] as const;
export type CleanTask = (typeof CLEAN_TASKS)[number]['value'];

export interface CareLog {
  id: string;
  kind: CareKind;
  aviary_id: string | null;
  section: string | null;
  bird_id: string | null;
  logged_at: string;
  log_date: string;
  staff_id: string;
  /** Who was using a shared device (staff_id is then the device) */
  logged_for?: string | null;
  /** A volunteer's name, logged on a shared device */
  logged_for_name?: string | null;
  tasks: string[];
  product: string | null;
  concern: boolean;
  notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution: string | null;
  voided_at: string | null;
  pending?: boolean;
}

export interface CareSettings {
  clean_due_days: number;
  clean_overdue_days: number;
  daily_sections: string[];
  products: string[];
  winter_start: string;
  winter_end: string;
  frost_below: number;
  ferret_foods?: string[];
  /** Cleaning timings per section, e.g. { Back: { due: 7, overdue: 14 } } */
  section_rules: Record<string, { due: number; overdue: number }>;
  /** Check / clean every bath this often (days) */
  bath_check_days: number;
  bath_clean_days: number;
  /** How many aviaries "Suggest" adds to today's list */
  suggest_count: number;
  /** Sections cleaned on each weekday, 1 = Monday ... 7 = Sunday */
  rota: Record<string, string[]>;
  /** How loud the cleaning alerts are: off, quiet (overdue aviaries only) or full */
  alert_level?: 'off' | 'quiet' | 'full';
  /** Feeding rounds in order; birds.feed_round counts from 1 */
  round_names?: string[];
}

export function roundNames(s: CareSettings): string[] {
  return s.round_names?.length ? s.round_names : ['Feeding round'];
}

/** One row of today's cleaning list; the latest row for an aviary on a day wins */
export interface CleanPlanRow {
  id: string;
  plan_date: string;
  aviary_id: string;
  added_by: string;
  added_at: string;
  removed_by: string | null;
  removed_at: string | null;
}

export const DEFAULT_CARE_SETTINGS: CareSettings = {
  clean_due_days: 7,
  clean_overdue_days: 14,
  daily_sections: ['Mews'],
  products: [CENTRE.defaultDisinfectant],
  winter_start: '11-01',
  winter_end: '03-31',
  frost_below: 1,
  section_rules: {},
  bath_check_days: 1,
  bath_clean_days: 3,
  suggest_count: 6,
  rota: {},
};

// ---------------------------------------------------------------------------
// Ferrets
// ---------------------------------------------------------------------------

export interface FerretCage {
  id: string;
  name: string;
  ferrets: number;
  names: string | null;
  sort: number;
  archived: boolean;
}

export interface FerretLog {
  id: string;
  cage_id: string;
  kind: 'feed' | 'clean' | 'weigh';
  food: string | null;
  /** For weigh logs */
  ferret_id?: string | null;
  weight_g?: number | null;
  tasks: string[];
  notes: string | null;
  logged_at: string;
  log_date: string;
  staff_id: string;
  /** Who was using a shared device (staff_id is then the device) */
  logged_for?: string | null;
  /** A volunteer's name, logged on a shared device */
  logged_for_name?: string | null;
  voided_at: string | null;
  pending?: boolean;
}

export interface Ferret {
  id: string;
  cage_id: string | null;
  name: string;
  sort: number;
  archived: boolean;
}

export const DEFAULT_FERRET_FOODS = ['Ferret biscuits', 'Raw meat', 'Chick', 'Mice', 'Rabbit', 'Egg'];

// ---------------------------------------------------------------------------
// GPS flight tracks (Marshall AeroVision)
// ---------------------------------------------------------------------------

export interface FlightTrackSummary {
  id: string;
  feed_log_id: string;
  bird_id: string;
  uploaded_by: string;
  uploaded_at: string;
  file_name: string | null;
  start_clock: string | null;
  trim_start: number;
  trim_end: number;
  duration_s: number;
  distance_m: number;
  max_speed_mph: number | null;
  avg_speed_mph: number | null;
  max_dist_m: number | null;
  gap_s: number;
  fast_s: number;
}

export interface FlightTrack extends FlightTrackSummary {
  /** [secs, lat, lon, mph, metres from you, height vs you] */
  track: [number, number, number, number | null, number | null, number | null][];
  me_track: [number, number, number][] | null;
}

export const TRACK_SUMMARY_COLUMNS =
  'id, feed_log_id, bird_id, uploaded_by, uploaded_at, file_name, start_clock, trim_start, trim_end, duration_s, distance_m, max_speed_mph, avg_speed_mph, max_dist_m, gap_s, fast_s';

// ---------------------------------------------------------------------------
// Health: issues, timeline entries, medication and doses
// ---------------------------------------------------------------------------

export interface HealthIssue {
  id: string;
  bird_id: string;
  title: string;
  started_on: string;
  photo_every_days: number | null;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  outcome: string | null;
  voided_at: string | null;
}

export interface HealthEntry {
  id: string;
  issue_id: string;
  bird_id: string;
  notes: string | null;
  action: string | null;
  photo_paths: string[];
  logged_at: string;
  log_date: string;
  staff_id: string;
  /** Who was using a shared device (staff_id is then the device) */
  logged_for?: string | null;
  /** A volunteer's name, logged on a shared device */
  logged_for_name?: string | null;
  voided_at: string | null;
}

export const MED_TYPES = [
  { value: 'fluid', label: 'Fluid' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'injection', label: 'Injection' },
  { value: 'cream', label: 'Cream' },
  { value: 'drops', label: 'Drops' },
  { value: 'other', label: 'Other' },
] as const;
export type MedType = (typeof MED_TYPES)[number]['value'];

export interface Medication {
  id: string;
  bird_id: string;
  issue_id: string | null;
  name_dose: string;
  med_type: MedType;
  amount: string;
  times_per_day: number;
  every_days: number;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  prescribed_by: string | null;
  prescription_paths: string[];
  created_by: string;
  created_at: string;
  stopped_by: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  voided_at: string | null;
}

export interface MedDose {
  id: string;
  medication_id: string;
  bird_id: string;
  dose_date: string;
  amount: string | null;
  notes: string | null;
  logged_at: string;
  staff_id: string;
  /** Who was using a shared device (staff_id is then the device) */
  logged_for?: string | null;
  /** A volunteer's name, logged on a shared device */
  logged_for_name?: string | null;
  voided_at: string | null;
  pending?: boolean;
}
