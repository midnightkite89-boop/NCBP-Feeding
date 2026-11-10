import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PostgrestError, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { addDays, londonDate } from './time';
import {
  DEFAULT_CARE_SETTINGS,
  type Aviary,
  type Bird,
  type CareKind,
  type CareLog,
  type CareSettings,
  type CleanPlanRow,
  type HealthEntry,
  type HealthIssue,
  type MedDose,
  type Medication,
  type FeedLog,
  type Ferret,
  type FerretCage,
  type FerretLog,
  type FlightType,
  type LogStatus,
  type Profile,
  type SpecialRequest,
} from './types';

// ---------------------------------------------------------------------------
// Offline queue: every change is saved on the phone first, then sent. If there
// is no signal it stays queued and is retried automatically.
// ---------------------------------------------------------------------------

export interface LogInput {
  bird_id: string;
  status: LogStatus;
  food_type: string | null;
  amount: string | null;
  weight_g: number | null;
  notes: string | null;
  more_due: boolean;
  more_due_amount?: string | null;
  /** When it happened, if not now (e.g. a flight logged afterwards) */
  logged_at?: string;
  flight_type?: FlightType | null;
  session_id?: string | null;
  /** Set when this log corrects an earlier one (which gets voided) */
  replaces?: string | null;
}

export interface RequestInput {
  bird_id: string | null;
  instruction: string;
  expires_on: string | null;
}

export interface CareInput {
  kind: CareKind;
  aviary_id?: string | null;
  section?: string | null;
  bird_id?: string | null;
  tasks?: string[];
  product?: string | null;
  concern?: boolean;
  notes?: string | null;
}

type LogRow = LogInput & { id: string; logged_at: string; logged_for?: string; logged_for_name?: string };
type CareRow = CareInput & { id: string; logged_at: string; logged_for?: string; logged_for_name?: string };

export interface FerretInput {
  cage_id: string;
  kind: 'feed' | 'clean' | 'weigh';
  food?: string | null;
  ferret_id?: string | null;
  weight_g?: number | null;
  tasks?: string[];
  notes?: string | null;
}
type FerretRow = FerretInput & { id: string; logged_at: string; logged_for?: string; logged_for_name?: string };
type RequestRow = RequestInput & { id: string; created_at: string };
type DoseRow = { id: string; medication_id: string; dose_date: string; amount: string | null; notes: string | null; logged_at: string; logged_for?: string; logged_for_name?: string };

type Op =
  | { kind: 'log'; row: LogRow; staff_id: string }
  | { kind: 'void'; id: string }
  | { kind: 'request'; row: RequestRow; created_by: string }
  | { kind: 'clear'; id: string }
  | { kind: 'care'; row: CareRow; staff_id: string }
  | { kind: 'care_void'; id: string }
  | { kind: 'resolve'; id: string; action: string; by: string }
  | { kind: 'ferret'; row: FerretRow; staff_id: string }
  | { kind: 'dose'; row: DoseRow; staff_id: string; bird_id: string }
  | { kind: 'dose_void'; id: string }
  | { kind: 'ferret_void'; id: string };

const QUEUE_KEY = 'smj-queue';
const SNAPSHOT_KEY = 'smj-snapshot';
const ACTING_KEY = 'smj-acting-as';
/** Who's using a shared device: a staff member (id) or a volunteer (typed name) */
export interface Acting {
  id: string | null;
  name: string | null;
}
const ACTING_IDLE_MS = 2 * 60 * 60 * 1000;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked – the app still works, just without offline backup
  }
}

/** Network problems and expired sessions are worth retrying; anything else is a real rejection. */
function isRetryable(error: PostgrestError | null): boolean {
  if (!error) return false;
  if (!navigator.onLine) return true;
  if (!error.code) return true;
  return error.code.startsWith('PGRST3');
}

// ---------------------------------------------------------------------------

interface Snapshot {
  today: string;
  profiles: Profile[];
  aviaries: Aviary[];
  birds: Bird[];
  logs: FeedLog[];
  requests: SpecialRequest[];
  care?: CareLog[];
  careSettings?: CareSettings;
  ferretCages?: FerretCage[];
  ferrets?: Ferret[];
  ferretLogs?: FerretLog[];
  healthIssues?: HealthIssue[];
  healthEntries?: HealthEntry[];
  medications?: Medication[];
  doses?: MedDose[];
}

export interface UndoAction {
  label: string;
  ids: string[];
  at: number;
  /** Undo voids care logs rather than feed logs */
  care?: boolean;
  /** Undo voids ferret logs */
  ferret?: boolean;
  /** Undo voids medication doses */
  dose?: boolean;
  /** Daily checks logged alongside a feed, undone with it */
  careIds?: string[];
}

interface Store {
  session: Session | null;
  authReady: boolean;
  me: Profile | null;
  isAdmin: boolean;
  today: string;
  loading: boolean;
  online: boolean;
  pendingCount: number;
  syncError: string | null;
  profiles: Profile[];
  aviaries: Aviary[];
  birds: Bird[];
  /** Today's non-voided logs, oldest first, including unsent ones */
  todayLogs: FeedLog[];
  /** "Food left" logs from the last 14 days, today's included, oldest first */
  leftovers: FeedLog[];
  /** Active special requests, including unsent ones */
  requests: SpecialRequest[];
  /** Care logs: last 45 days plus any open concerns; non-voided, oldest first, including unsent */
  careLogs: CareLog[];
  careSettings: CareSettings;
  ferretCages: FerretCage[];
  /** Individual ferrets, for weighing */
  ferrets: Ferret[];
  /** Ferret logs from the last 45 days, non-voided, oldest first, including unsent */
  ferretLogs: FerretLog[];
  /** Today's cleaning list rows (today and yesterday) */
  cleanPlan: CleanPlanRow[];
  addToCleanPlan: (aviaryIds: string[]) => void;
  removeFromCleanPlan: (aviaryId: string) => void;
  /** Open health issues, their entries, current medication, and doses from yesterday and today */
  healthIssues: HealthIssue[];
  healthEntries: HealthEntry[];
  medications: Medication[];
  doses: MedDose[];
  giveDose: (med: Medication, label: string) => void;
  voidDose: (id: string) => void;
  refreshHealth: () => Promise<void>;
  photoUrls: Record<string, string>;
  undo: UndoAction | null;
  staffName: (id: string | null) => string;
  /** Who did it: "Gill (Shed iPad)" when logged on a shared device, else the person */
  logName: (row: { staff_id: string; logged_for?: string | null; logged_for_name?: string | null }) => string;
  /** On a shared device: the person currently using it (null = nobody picked) */
  acting: Acting | null;
  setActingFor: (who: Acting | null) => void;
  /** Fields to add to a row saved straight to the server (e.g. health updates) */
  actingFields: () => { logged_for?: string; logged_for_name?: string };
  /** alsoCheck: record the daily check for these birds too (feeding means the bird was seen) */
  logFeeds: (entries: LogInput[], label: string, opts?: { alsoCheck?: boolean }) => void;
  undoLast: () => void;
  voidLog: (id: string) => void;
  correctLog: (old: FeedLog, next: LogInput) => void;
  addRequest: (input: RequestInput) => void;
  clearRequest: (id: string) => void;
  logCare: (entries: CareInput[], label: string) => void;
  voidCare: (id: string) => void;
  resolveConcern: (id: string, action: string) => void;
  logFerret: (entries: FerretInput[], label: string) => void;
  dismissUndo: () => void;
  dismissSyncError: () => void;
  refresh: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [today, setToday] = useState(londonDate);
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);

  const snapshot = useMemo(() => readJson<Snapshot | null>(SNAPSHOT_KEY, null), []);
  const [profiles, setProfiles] = useState<Profile[]>(snapshot?.profiles ?? []);
  const [aviaries, setAviaries] = useState<Aviary[]>(snapshot?.aviaries ?? []);
  const [birds, setBirds] = useState<Bird[]>(snapshot?.birds ?? []);
  const [serverLogs, setServerLogs] = useState<FeedLog[]>(snapshot?.today === today ? snapshot.logs : []);
  const [earlierLeftovers, setEarlierLeftovers] = useState<FeedLog[]>([]);
  const [serverRequests, setServerRequests] = useState<SpecialRequest[]>(snapshot?.requests ?? []);
  const [serverCare, setServerCare] = useState<CareLog[]>(snapshot?.care ?? []);
  const [careSettings, setCareSettings] = useState<CareSettings>(snapshot?.careSettings ?? DEFAULT_CARE_SETTINGS);
  const [ferretCages, setFerretCages] = useState<FerretCage[]>(snapshot?.ferretCages ?? []);
  const [ferrets, setFerrets] = useState<Ferret[]>(snapshot?.ferrets ?? []);
  const [serverFerret, setServerFerret] = useState<FerretLog[]>(snapshot?.ferretLogs ?? []);
  const [cleanPlan, setCleanPlan] = useState<CleanPlanRow[]>([]);
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>(snapshot?.healthIssues ?? []);
  const [healthEntries, setHealthEntries] = useState<HealthEntry[]>(snapshot?.healthEntries ?? []);
  const [medications, setMedications] = useState<Medication[]>(snapshot?.medications ?? []);
  const [serverDoses, setServerDoses] = useState<MedDose[]>(snapshot?.doses ?? []);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const queueRef = useRef<Op[]>(readJson<Op[]>(QUEUE_KEY, []));
  const [queue, setQueueState] = useState<Op[]>(queueRef.current);
  const inFlight = useRef<Op | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  // Shared device: who's using it. Forgotten after 2 hours idle or overnight.
  const [actingSaved, setActingSaved] = useState<(Acting & { at: number; date: string }) | null>(() => readJson(ACTING_KEY, null));
  const actingForRef = useRef<() => Acting | null>(() => null);
  /** logged_for to add to a new row (and keep the person "active") */
  const stamp = useCallback((): { logged_for?: string; logged_for_name?: string } => {
    const who = actingForRef.current();
    if (!who) return {};
    const next = { ...who, at: Date.now(), date: londonDate() };
    setActingSaved(next);
    writeJson(ACTING_KEY, next);
    return who.id ? { logged_for: who.id } : who.name ? { logged_for_name: who.name } : {};
  }, []);

  const careLogsRef = useRef<CareLog[]>([]);
  const todayRef = useRef(today);
  todayRef.current = today;

  const setQueue = useCallback((next: Op[]) => {
    queueRef.current = next;
    writeJson(QUEUE_KEY, next);
    setQueueState(next);
  }, []);

  // --- auth -----------------------------------------------------------------

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // --- loading --------------------------------------------------------------

  const fetchLogs = useCallback(async () => {
    const { data, error } = await supabase.from('feed_logs').select('*').eq('log_date', todayRef.current).order('logged_at');
    if (!error && data) setServerLogs(data as FeedLog[]);
  }, []);

  // Leftovers before today, for spotting birds that keep leaving food (today's come with todayLogs)
  const fetchLeftovers = useCallback(async () => {
    const { data, error } = await supabase
      .from('feed_logs')
      .select('*')
      .eq('status', 'left')
      .is('voided_at', null)
      .gte('log_date', addDays(todayRef.current, -14))
      .lt('log_date', todayRef.current)
      .order('logged_at');
    if (!error && data) setEarlierLeftovers(data as FeedLog[]);
  }, []);

  const fetchRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from('special_requests')
      .select('*')
      .is('cleared_at', null)
      .or(`expires_on.is.null,expires_on.gte.${todayRef.current}`)
      .order('created_at');
    if (!error && data) setServerRequests(data as SpecialRequest[]);
  }, []);

  const fetchCare = useCallback(async () => {
    const [recent, open, settings] = await Promise.all([
      supabase.from('care_logs').select('*').gte('log_date', addDays(todayRef.current, -45)).order('logged_at'),
      supabase.from('care_logs').select('*').eq('concern', true).is('resolved_at', null).is('voided_at', null),
      supabase.from('care_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (!recent.error && recent.data) {
      const byId = new Map<string, CareLog>();
      for (const l of [...(open.data ?? []), ...recent.data] as CareLog[]) byId.set(l.id, l);
      setServerCare([...byId.values()]);
    }
    if (!settings.error && settings.data) setCareSettings({ ...DEFAULT_CARE_SETTINGS, ...(settings.data as Partial<CareSettings>) });
  }, []);

  const fetchHealth = useCallback(async () => {
    const day = todayRef.current;
    const [issues, meds, doses] = await Promise.all([
      supabase.from('health_issues').select('*').is('closed_at', null).is('voided_at', null).order('opened_at'),
      supabase.from('medications').select('*').is('stopped_at', null).is('voided_at', null).or(`end_date.is.null,end_date.gte.${addDays(day, -1)}`).order('created_at'),
      supabase.from('med_doses').select('*').gte('dose_date', addDays(day, -1)).is('voided_at', null).order('logged_at'),
    ]);
    if (!issues.error && issues.data) {
      setHealthIssues(issues.data as HealthIssue[]);
      const ids = (issues.data as HealthIssue[]).map((i) => i.id);
      if (ids.length) {
        const entries = await supabase.from('health_entries').select('*').in('issue_id', ids).is('voided_at', null).order('logged_at');
        if (!entries.error && entries.data) setHealthEntries(entries.data as HealthEntry[]);
      } else setHealthEntries([]);
    }
    if (!meds.error && meds.data) setMedications(meds.data as Medication[]);
    if (!doses.error && doses.data) setServerDoses(doses.data as MedDose[]);
  }, []);

  const fetchPlan = useCallback(async () => {
    const { data, error } = await supabase.from('clean_plan').select('*').gte('plan_date', addDays(todayRef.current, -1)).order('added_at');
    if (!error && data) setCleanPlan(data as CleanPlanRow[]);
  }, []);

  const fetchFerrets = useCallback(async () => {
    const [cages, logs] = await Promise.all([
      supabase.from('ferret_cages').select('*').eq('archived', false).order('sort'),
      supabase.from('ferret_logs').select('*').is('voided_at', null).gte('log_date', addDays(todayRef.current, -45)).order('logged_at'),
    ]);
    if (!cages.error && cages.data) setFerretCages(cages.data as FerretCage[]);
    const animals = await supabase.from('ferrets').select('*').eq('archived', false).order('sort');
    if (!animals.error && animals.data) setFerrets(animals.data as Ferret[]);
    if (!logs.error && logs.data) setServerFerret(logs.data as FerretLog[]);
  }, []);

  const fetchBirdsAndAviaries = useCallback(async () => {
    const [b, a, p] = await Promise.all([
      supabase.from('birds').select('*').order('name'),
      supabase.from('aviaries').select('*').order('number', { nullsFirst: false }).order('name'),
      supabase.from('profiles').select('id, display_name, role, shared_device').order('display_name'),
    ]);
    if (!b.error && b.data) setBirds(b.data as Bird[]);
    if (!a.error && a.data) setAviaries(a.data as Aviary[]);
    if (!p.error && p.data) setProfiles(p.data as Profile[]);
    else if (p.error) {
      // Database without the shared-device column yet: load the basics
      const basic = await supabase.from('profiles').select('id, display_name, role').order('display_name');
      if (!basic.error && basic.data) setProfiles(basic.data as Profile[]);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    await Promise.all([fetchBirdsAndAviaries(), fetchLogs(), fetchLeftovers(), fetchRequests(), fetchCare(), fetchFerrets(), fetchPlan(), fetchHealth()]);
    setLoading(false);
  }, [userId, fetchBirdsAndAviaries, fetchLogs, fetchLeftovers, fetchRequests, fetchCare, fetchFerrets, fetchPlan, fetchHealth]);

  // Keep a copy on the phone so the app opens with data even without signal.
  useEffect(() => {
    if (!userId || loading) return;
    writeJson(SNAPSHOT_KEY, {
      today,
      profiles,
      aviaries,
      birds,
      logs: serverLogs,
      requests: serverRequests,
      care: serverCare,
      careSettings,
      ferretCages,
      ferrets,
      ferretLogs: serverFerret,
      healthIssues,
      healthEntries,
      medications,
      doses: serverDoses,
    } satisfies Snapshot);
  }, [userId, loading, today, profiles, aviaries, birds, serverLogs, serverRequests, serverCare, careSettings, ferretCages, ferrets, serverFerret, healthIssues, healthEntries, medications, serverDoses]);

  // Bird photos are private; fetch signed links for any we don't have yet.
  useEffect(() => {
    const missing = birds.map((b) => b.photo_path).filter((p): p is string => !!p && !photoUrls[p]);
    if (!userId || missing.length === 0) return;
    supabase.storage
      .from('bird-photos')
      .createSignedUrls(missing, 60 * 60 * 24 * 7)
      .then(({ data }) => {
        if (!data) return;
        setPhotoUrls((prev) => {
          const next = { ...prev };
          for (const item of data) if (item.path && item.signedUrl) next[item.path] = item.signedUrl;
          return next;
        });
      });
  }, [userId, birds, photoUrls]);

  // --- sending the queue ----------------------------------------------------

  const flushing = useRef(false);

  const send = useCallback(async (op: Op): Promise<'ok' | 'retry' | string> => {
    let error: PostgrestError | null = null;
    if (op.kind === 'log') {
      const res = await supabase.from('feed_logs').insert(op.row).select().single();
      error = res.error;
      if (res.data) setServerLogs((prev) => upsertById(prev, res.data as FeedLog));
    } else if (op.kind === 'void') {
      error = (await supabase.rpc('void_feed_log', { log_id: op.id })).error;
      if (!error) setServerLogs((prev) => prev.map((l) => (l.id === op.id ? { ...l, voided_at: new Date().toISOString() } : l)));
    } else if (op.kind === 'request') {
      const res = await supabase.from('special_requests').insert(op.row).select().single();
      error = res.error;
      if (res.data) setServerRequests((prev) => upsertById(prev, res.data as SpecialRequest));
    } else if (op.kind === 'clear') {
      error = (await supabase.rpc('clear_special_request', { request_id: op.id })).error;
      if (!error) setServerRequests((prev) => prev.filter((r) => r.id !== op.id));
    } else if (op.kind === 'care') {
      const res = await supabase.from('care_logs').insert(op.row).select().single();
      error = res.error;
      if (res.data) setServerCare((prev) => upsertById(prev, res.data as CareLog));
    } else if (op.kind === 'care_void') {
      error = (await supabase.rpc('void_care_log', { log_id: op.id })).error;
      if (!error) setServerCare((prev) => prev.map((l) => (l.id === op.id ? { ...l, voided_at: new Date().toISOString() } : l)));
    } else if (op.kind === 'ferret') {
      const res = await supabase.from('ferret_logs').insert(op.row).select().single();
      error = res.error;
      if (res.data) setServerFerret((prev) => upsertById(prev, res.data as FerretLog));
    } else if (op.kind === 'dose') {
      const res = await supabase.from('med_doses').insert(op.row).select().single();
      error = res.error;
      if (res.data) setServerDoses((prev) => upsertById(prev, res.data as MedDose));
    } else if (op.kind === 'dose_void') {
      error = (await supabase.rpc('void_health_row', { p_table: 'med_doses', p_id: op.id })).error;
      if (!error) setServerDoses((prev) => prev.map((d) => (d.id === op.id ? { ...d, voided_at: new Date().toISOString() } : d)));
    } else if (op.kind === 'ferret_void') {
      error = (await supabase.rpc('void_ferret_log', { log_id: op.id })).error;
      if (!error) setServerFerret((prev) => prev.map((l) => (l.id === op.id ? { ...l, voided_at: new Date().toISOString() } : l)));
    } else {
      error = (await supabase.rpc('resolve_concern', { log_id: op.id, action: op.action })).error;
      if (!error)
        setServerCare((prev) => prev.map((l) => (l.id === op.id ? { ...l, resolved_at: new Date().toISOString(), resolved_by: op.by, resolution: op.action } : l)));
    }
    if (!error || error.code === '23505') return 'ok'; // 23505 = already saved on an earlier attempt
    if (isRetryable(error)) return 'retry';
    return error.message;
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !userId) return;
    flushing.current = true;
    try {
      while (queueRef.current.length > 0) {
        const op = queueRef.current[0];
        inFlight.current = op;
        let result: Awaited<ReturnType<typeof send>>;
        try {
          result = await send(op);
        } catch {
          result = 'retry';
        }
        inFlight.current = null;
        if (result === 'retry') break;
        if (result !== 'ok') setSyncError(`A change could not be saved: ${result}`);
        setQueue(queueRef.current.filter((o) => o !== op));
      }
    } finally {
      inFlight.current = null;
      flushing.current = false;
    }
  }, [userId, send, setQueue]);

  const enqueue = useCallback(
    (ops: Op[]) => {
      setQueue([...queueRef.current, ...ops]);
      void flush();
    },
    [flush, setQueue],
  );

  // --- live updates, reconnects, midnight ---------------------------------

  useEffect(() => {
    if (!userId) return;
    void refresh();
    void flush();

    const channel = supabase
      .channel('smj-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_logs' }, (payload) => {
        const row = payload.new as FeedLog;
        if (row?.log_date === todayRef.current) setServerLogs((prev) => upsertById(prev, row));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'special_requests' }, () => void fetchRequests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'care_logs' }, (payload) => {
        const row = payload.new as CareLog;
        if (row?.id) setServerCare((prev) => upsertById(prev, row));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'care_settings' }, () => void fetchCare())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ferret_logs' }, (payload) => {
        const row = payload.new as FerretLog;
        if (row?.id) setServerFerret((prev) => upsertById(prev, row));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ferret_cages' }, () => void fetchFerrets())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ferrets' }, () => void fetchFerrets())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_issues' }, () => void fetchHealth())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_entries' }, () => void fetchHealth())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medications' }, () => void fetchHealth())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'med_doses' }, (payload) => {
        const row = payload.new as MedDose;
        if (row?.id) setServerDoses((prev) => upsertById(prev, row));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clean_plan' }, (payload) => {
        const row = payload.new as CleanPlanRow;
        if (row?.id) setCleanPlan((prev) => upsertById(prev, row));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'birds' }, () => void fetchBirdsAndAviaries())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aviaries' }, () => void fetchBirdsAndAviaries())
      .subscribe((status) => {
        // After any reconnect, catch up on whatever was missed.
        if (status === 'SUBSCRIBED') void refresh();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh, flush, fetchRequests, fetchBirdsAndAviaries, fetchCare, fetchFerrets, fetchHealth]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
      void refresh();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') goOnline();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);

    // Every 20 s: roll over at midnight (London), and retry anything unsent.
    const timer = window.setInterval(() => {
      const now = londonDate();
      if (now !== todayRef.current) {
        todayRef.current = now;
        setToday(now);
        setServerLogs([]);
        void refresh();
      }
      if (queueRef.current.length > 0) void flush();
    }, 20_000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [flush, refresh]);

  // --- actions --------------------------------------------------------------

  const logFeeds = useCallback(
    (entries: LogInput[], label: string, opts?: { alsoCheck?: boolean }) => {
      if (!userId || entries.length === 0) return;
      const now = new Date().toISOString();
      const who = stamp();
      const ops: Op[] = entries.map(({ more_due_amount, logged_at, flight_type, session_id, replaces, ...e }) => ({
        kind: 'log',
        staff_id: userId,
        row: {
          ...e,
          ...(more_due_amount ? { more_due_amount } : {}),
          ...(flight_type ? { flight_type } : {}),
          ...(session_id ? { session_id } : {}),
          ...(replaces ? { replaces } : {}),
          ...who,
          id: crypto.randomUUID(),
          logged_at: logged_at ?? now,
        },
      }));
      // Feeding counts as the daily check for any bird not already checked today
      const today = londonDate();
      const checkOps: Op[] = opts?.alsoCheck
        ? [...new Set(entries.map((e) => e.bird_id))]
            .filter((birdId) => !careLogsRef.current.some((l) => l.kind === 'bird_check' && l.bird_id === birdId && l.log_date === today))
            .map((birdId) => ({ kind: 'care', staff_id: userId, row: { kind: 'bird_check', bird_id: birdId, tasks: [], concern: false, ...who, id: crypto.randomUUID(), logged_at: now } }))
        : [];
      enqueue([...ops, ...checkOps]);
      setUndo({
        label,
        ids: ops.map((o) => (o as { row: LogRow }).row.id),
        careIds: checkOps.map((o) => (o as { row: CareRow }).row.id),
        at: Date.now(),
      });
    },
    [userId, enqueue],
  );

  const voidLogs = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      // An unsent log can simply be taken back out of the queue. Anything
      // already sent (or being sent right now) gets voided on the server.
      const unsent = queueRef.current.filter((o) => o.kind === 'log' && idSet.has(o.row.id) && o !== inFlight.current);
      const unsentIds = new Set(unsent.map((o) => (o as { row: LogRow }).row.id));
      const remaining = queueRef.current.filter((o) => !unsent.includes(o));
      const voids: Op[] = ids.filter((id) => !unsentIds.has(id)).map((id) => ({ kind: 'void', id }));
      setQueue([...remaining, ...voids]);
      void flush();
    },
    [flush, setQueue],
  );

  const logCare = useCallback(
    (entries: CareInput[], label: string) => {
      if (!userId || entries.length === 0) return;
      const now = new Date().toISOString();
      const who = stamp();
      const ops: Op[] = entries.map((e) => ({ kind: 'care', staff_id: userId, row: { tasks: [], concern: false, ...e, ...who, id: crypto.randomUUID(), logged_at: now } }));
      enqueue(ops);
      setUndo({ label, ids: ops.map((o) => (o as { row: CareRow }).row.id), at: Date.now(), care: true });
    },
    [userId, enqueue],
  );

  const voidCareLogs = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const unsent = queueRef.current.filter((o) => o.kind === 'care' && idSet.has(o.row.id) && o !== inFlight.current);
      const unsentIds = new Set(unsent.map((o) => (o as { row: CareRow }).row.id));
      const remaining = queueRef.current.filter((o) => !unsent.includes(o));
      const voids: Op[] = ids.filter((id) => !unsentIds.has(id)).map((id) => ({ kind: 'care_void', id }));
      setQueue([...remaining, ...voids]);
      void flush();
    },
    [flush, setQueue],
  );

  const voidCare = useCallback((id: string) => voidCareLogs([id]), [voidCareLogs]);

  const resolveConcern = useCallback(
    (id: string, action: string) => {
      if (!userId || !action.trim()) return;
      enqueue([{ kind: 'resolve', id, action: action.trim(), by: userId }]);
    },
    [userId, enqueue],
  );

  const logFerret = useCallback(
    (entries: FerretInput[], label: string) => {
      if (!userId || entries.length === 0) return;
      const now = new Date().toISOString();
      const who = stamp();
      const ops: Op[] = entries.map((e) => ({ kind: 'ferret', staff_id: userId, row: { tasks: [], ...e, ...who, id: crypto.randomUUID(), logged_at: now } }));
      enqueue(ops);
      setUndo({ label, ids: ops.map((o) => (o as { row: FerretRow }).row.id), at: Date.now(), ferret: true });
    },
    [userId, enqueue],
  );

  const voidFerretLogs = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const unsent = queueRef.current.filter((o) => o.kind === 'ferret' && idSet.has(o.row.id) && o !== inFlight.current);
      const unsentIds = new Set(unsent.map((o) => (o as { row: FerretRow }).row.id));
      const remaining = queueRef.current.filter((o) => !unsent.includes(o));
      const voids: Op[] = ids.filter((id) => !unsentIds.has(id)).map((id) => ({ kind: 'ferret_void', id }));
      setQueue([...remaining, ...voids]);
      void flush();
    },
    [flush, setQueue],
  );

  const giveDose = useCallback(
    (med: Medication, label: string) => {
      if (!userId) return;
      const now = new Date().toISOString();
      const op: Op = { kind: 'dose', staff_id: userId, bird_id: med.bird_id, row: { id: crypto.randomUUID(), medication_id: med.id, dose_date: londonDate(), amount: med.amount, notes: null, ...stamp(), logged_at: now } };
      enqueue([op]);
      setUndo({ label, ids: [op.row.id], at: Date.now(), dose: true });
    },
    [userId, enqueue],
  );

  const voidDoses = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const unsent = queueRef.current.filter((o) => o.kind === 'dose' && idSet.has(o.row.id) && o !== inFlight.current);
      const unsentIds = new Set(unsent.map((o) => (o as { row: DoseRow }).row.id));
      const remaining = queueRef.current.filter((o) => !unsent.includes(o));
      const voids: Op[] = ids.filter((id) => !unsentIds.has(id)).map((id) => ({ kind: 'dose_void', id }));
      setQueue([...remaining, ...voids]);
      void flush();
    },
    [flush, setQueue],
  );

  const undoLast = useCallback(() => {
    if (undo) {
      (undo.dose ? voidDoses : undo.ferret ? voidFerretLogs : undo.care ? voidCareLogs : voidLogs)(undo.ids);
      if (undo.careIds?.length) voidCareLogs(undo.careIds);
    }
    setUndo(null);
  }, [undo, voidLogs, voidCareLogs, voidFerretLogs, voidDoses]);

  const voidLog = useCallback((id: string) => voidLogs([id]), [voidLogs]);

  /** Change a logged feed or flight: the original is voided and a corrected copy logged in its place */
  const correctLog = useCallback(
    (old: FeedLog, next: LogInput) => {
      if (!userId) return;
      const unsent = queueRef.current.some((o) => o.kind === 'log' && o.row.id === old.id && o !== inFlight.current);
      voidLogs([old.id]);
      // A log that never reached the server has nothing to point back to
      logFeeds([{ ...next, replaces: unsent ? null : old.id }], 'Changed');
      setUndo(null);
    },
    [userId, voidLogs, logFeeds],
  );

  const addRequest = useCallback(
    (input: RequestInput) => {
      if (!userId) return;
      enqueue([{ kind: 'request', created_by: userId, row: { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString() } }]);
    },
    [userId, enqueue],
  );

  const clearRequest = useCallback((id: string) => enqueue([{ kind: 'clear', id }]), [enqueue]);

  // --- derived views ----------------------------------------------------------

  const todayLogs = useMemo(() => {
    const voidIds = new Set(queue.filter((o) => o.kind === 'void').map((o) => (o as { id: string }).id));
    const byId = new Map<string, FeedLog>();
    for (const l of serverLogs) byId.set(l.id, l);
    for (const o of queue) {
      if (o.kind !== 'log' || byId.has(o.row.id)) continue;
      const log_date = londonDate(new Date(o.row.logged_at));
      byId.set(o.row.id, { ...o.row, log_date, staff_id: o.staff_id, voided_by: null, voided_at: null, pending: true });
    }
    return [...byId.values()]
      .filter((l) => l.log_date === today && !l.voided_at && !voidIds.has(l.id))
      .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  }, [serverLogs, queue, today]);

  const leftovers = useMemo(
    () => [...earlierLeftovers.filter((l) => l.log_date < today), ...todayLogs.filter((l) => l.status === 'left')],
    [earlierLeftovers, todayLogs, today],
  );

  const requests = useMemo(() => {
    const cleared = new Set(queue.filter((o) => o.kind === 'clear').map((o) => (o as { id: string }).id));
    const byId = new Map<string, SpecialRequest>();
    for (const r of serverRequests) byId.set(r.id, r);
    for (const o of queue) {
      if (o.kind !== 'request' || byId.has(o.row.id)) continue;
      byId.set(o.row.id, { ...o.row, created_by: o.created_by, cleared_by: null, cleared_at: null, pending: true });
    }
    return [...byId.values()].filter((r) => !r.cleared_at && !cleared.has(r.id) && (!r.expires_on || r.expires_on >= today));
  }, [serverRequests, queue, today]);

  const careLogs = useMemo(() => {
    const voided = new Set(queue.filter((o) => o.kind === 'care_void').map((o) => (o as { id: string }).id));
    const resolving = new Map(queue.filter((o) => o.kind === 'resolve').map((o) => [(o as { id: string }).id, o as { action: string; by: string }]));
    const byId = new Map<string, CareLog>();
    for (const l of serverCare) byId.set(l.id, l);
    for (const o of queue) {
      if (o.kind !== 'care' || byId.has(o.row.id)) continue;
      byId.set(o.row.id, {
        aviary_id: null,
        section: null,
        bird_id: null,
        product: null,
        notes: null,
        tasks: [],
        concern: false,
        ...o.row,
        log_date: londonDate(new Date(o.row.logged_at)),
        staff_id: o.staff_id,
        resolved_by: null,
        resolved_at: null,
        resolution: null,
        voided_at: null,
        pending: true,
      });
    }
    return [...byId.values()]
      .filter((l) => !l.voided_at && !voided.has(l.id))
      .map((l) => {
        const res = resolving.get(l.id);
        return res && !l.resolved_at ? { ...l, resolved_at: new Date().toISOString(), resolved_by: res.by, resolution: res.action, pending: true } : l;
      })
      .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  }, [serverCare, queue]);

  const ferretLogs = useMemo(() => {
    const voided = new Set(queue.filter((o) => o.kind === 'ferret_void').map((o) => (o as { id: string }).id));
    const byId = new Map<string, FerretLog>();
    for (const l of serverFerret) byId.set(l.id, l);
    for (const o of queue) {
      if (o.kind !== 'ferret' || byId.has(o.row.id)) continue;
      byId.set(o.row.id, {
        food: null,
        notes: null,
        tasks: [],
        ...o.row,
        log_date: londonDate(new Date(o.row.logged_at)),
        staff_id: o.staff_id,
        voided_at: null,
        pending: true,
      });
    }
    return [...byId.values()].filter((l) => !l.voided_at && !voided.has(l.id)).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  }, [serverFerret, queue]);

  careLogsRef.current = careLogs;

  const doses = useMemo(() => {
    const voided = new Set(queue.filter((o) => o.kind === 'dose_void').map((o) => (o as { id: string }).id));
    const byId = new Map<string, MedDose>();
    for (const d of serverDoses) byId.set(d.id, d);
    for (const o of queue) {
      if (o.kind !== 'dose' || byId.has(o.row.id)) continue;
      byId.set(o.row.id, { ...o.row, bird_id: o.bird_id, staff_id: o.staff_id, voided_at: null, pending: true });
    }
    return [...byId.values()].filter((d) => !d.voided_at && !voided.has(d.id)).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  }, [serverDoses, queue]);

  // The cleaning list needs signal: it's shared planning, not a record of work done
  const addToCleanPlan = useCallback(
    (aviaryIds: string[]) => {
      if (!userId || aviaryIds.length === 0) return;
      const now = new Date().toISOString();
      const rows: CleanPlanRow[] = aviaryIds.map((aviary_id) => ({ id: crypto.randomUUID(), plan_date: today, aviary_id, added_by: userId, added_at: now, removed_by: null, removed_at: null }));
      setCleanPlan((prev) => [...prev, ...rows]);
      void supabase
        .from('clean_plan')
        .insert(rows.map(({ id, plan_date, aviary_id }) => ({ id, plan_date, aviary_id })))
        .select()
        .then(({ data, error }) => {
          if (error) {
            setCleanPlan((prev) => prev.filter((r) => !rows.some((x) => x.id === r.id)));
            setSyncError(navigator.onLine ? `Couldn't update the cleaning list: ${error.message}` : 'The cleaning list needs signal – try again when you have it.');
          } else if (data) setCleanPlan((prev) => (data as CleanPlanRow[]).reduce(upsertById, prev));
        });
    },
    [userId, today],
  );

  const removeFromCleanPlan = useCallback(
    (aviaryId: string) => {
      if (!userId) return;
      const now = new Date().toISOString();
      const temp: CleanPlanRow = { id: crypto.randomUUID(), plan_date: today, aviary_id: aviaryId, added_by: userId, added_at: now, removed_by: userId, removed_at: now };
      setCleanPlan((prev) => [...prev, temp]);
      void supabase.rpc('remove_from_clean_plan', { p_date: today, p_aviary: aviaryId }).then(({ error }) => {
        if (error) {
          setCleanPlan((prev) => prev.filter((r) => r.id !== temp.id));
          setSyncError(navigator.onLine ? `Couldn't update the cleaning list: ${error.message}` : 'The cleaning list needs signal – try again when you have it.');
        }
      });
    },
    [userId, today],
  );

  const me = profiles.find((p) => p.id === userId) ?? null;

  const actingNow = (): Acting | null => {
    const a = actingSaved;
    if (!me?.shared_device || !a) return null;
    if (a.date !== londonDate() || Date.now() - a.at > ACTING_IDLE_MS) return null;
    if (a.id) return profiles.some((p) => p.id === a.id && !p.shared_device) ? { id: a.id, name: null } : null;
    return a.name?.trim() ? { id: null, name: a.name.trim() } : null;
  };
  actingForRef.current = actingNow;
  const acting = actingNow();
  const setActingFor = useCallback((who: Acting | null) => {
    const next = who ? { ...who, at: Date.now(), date: londonDate() } : null;
    setActingSaved(next);
    writeJson(ACTING_KEY, next);
  }, []);

  const staffName = useCallback(
    (id: string | null) => (id ? (profiles.find((p) => p.id === id)?.display_name ?? 'Unknown') : ''),
    [profiles],
  );
  const logName = useCallback(
    (row: { staff_id: string; logged_for?: string | null; logged_for_name?: string | null }) =>
      row.logged_for && row.logged_for !== row.staff_id
        ? `${staffName(row.logged_for)} (${staffName(row.staff_id)})`
        : row.logged_for_name
          ? `${row.logged_for_name} (volunteer, ${staffName(row.staff_id)})`
          : staffName(row.staff_id),
    [staffName],
  );

  const value: Store = {
    session,
    authReady,
    me,
    isAdmin: me?.role === 'admin',
    today,
    loading: loading && birds.length === 0,
    online,
    pendingCount: queue.length,
    syncError,
    profiles,
    aviaries,
    birds,
    todayLogs,
    leftovers,
    requests,
    careLogs,
    careSettings,
    ferretCages,
    ferrets,
    ferretLogs,
    cleanPlan,
    addToCleanPlan,
    removeFromCleanPlan,
    healthIssues,
    healthEntries,
    medications,
    doses,
    giveDose,
    voidDose: (id: string) => voidDoses([id]),
    refreshHealth: fetchHealth,
    photoUrls,
    undo,
    staffName,
    logName,
    acting,
    setActingFor,
    actingFields: stamp,
    logFeeds,
    undoLast,
    voidLog,
    correctLog,
    addRequest,
    clearRequest,
    logCare,
    voidCare,
    resolveConcern,
    logFerret,
    dismissUndo: () => setUndo(null),
    dismissSyncError: () => setSyncError(null),
    refresh,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}
