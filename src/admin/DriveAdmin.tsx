import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { formatDay, formatTime } from '../time';

interface QueueRow {
  id: number;
  kind: string;
  created_at: string;
  done_at: string | null;
  attempts: number;
  last_error: string | null;
  note: string | null;
}

const KIND: Record<string, string> = {
  bird_photo: 'Bird photo',
  health_entry: 'Health update',
  entry_removed: 'Health update removed',
  issue_closed: 'Issue closed',
  medication: 'Medication',
  med_stopped: 'Medication stopped',
  dose: 'Dose given',
  dose_removed: 'Dose removed',
};

/** What's been copied to Google Drive, what's waiting and what failed */
export function DriveAdmin() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTidy, setConfirmTidy] = useState(false);
  const [tidyReport, setTidyReport] = useState<string[] | null>(null);

  async function load() {
    const [recent, waiting] = await Promise.all([
      supabase.from('drive_queue').select('*').order('id', { ascending: false }).limit(40),
      supabase.from('drive_queue').select('id', { count: 'exact', head: true }).is('done_at', null),
    ]);
    if (recent.error) setMsg(recent.error.message);
    setRows((recent.data ?? []) as QueueRow[]);
    setPending(waiting.count ?? 0);
  }
  useEffect(() => {
    void load();
  }, []);

  async function runNow() {
    setBusy(true);
    setMsg('Copying…');
    const { data, error } = await supabase.functions.invoke('drive-sync');
    setBusy(false);
    setMsg(error ? `Couldn't run the copier: ${error.message}` : `Done: ${(data as { done?: number })?.done ?? 0} item(s) handled.`);
    await load();
  }

  async function retry() {
    const { data, error } = await supabase.rpc('drive_retry_failed');
    setMsg(error ? error.message : `${data ?? 0} item(s) will be tried again.`);
    await runNow();
  }

  async function tidy() {
    setConfirmTidy(false);
    setBusy(true);
    setMsg('Tidying…');
    const { data, error } = await supabase.functions.invoke('drive-sync', { body: { action: 'tidy', since: '2026-10-31T00:00:00Z' } });
    setBusy(false);
    setMsg(error ? `Couldn't tidy: ${error.message}` : null);
    setTidyReport((data as { results?: string[] })?.results ?? null);
  }

  const failed = (rows ?? []).filter((r) => !r.done_at && r.last_error);

  return (
    <div>
      <h1 className="page-title">Google Drive copying</h1>
      <p className="muted">
        Bird photos, health updates and photos, prescriptions and doses are copied into each bird's folder in the SMJ Falconry Database, and onto their Vet Treatment
        Log. It runs every few minutes by itself.
      </p>
      <section className={`counter ${pending === 0 ? 'counter-done' : 'counter-todo'}`}>
        <div className="counter-big">{pending === 0 ? '✓ Everything copied' : `${pending} waiting to copy`}</div>
        {failed.length > 0 && <div className="counter-sub">{failed.length} having problems – see below</div>}
      </section>
      <div className="bird-actions">
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={runNow}>
          Copy now
        </button>
        {failed.length > 0 && (
          <button className="btn btn-outline btn-lg" disabled={busy} onClick={retry}>
            Try failed ones again
          </button>
        )}
      </div>
      {msg && <p className="muted">{msg}</p>}

      <section className="panel">
        <h2>Tidy up doubles</h2>
        <p className="muted">
          On the first day some items were copied twice (two runs at the same moment; that's fixed now). This removes the repeated rows on the Vet Treatment Logs and
          moves the spare copies of photo folders to the Drive bin, where they stay for 30 days. Only things copied since 31 Oct are checked.
        </p>
        {confirmTidy ? (
          <div className="confirm-inline">
            <span>Remove the doubles now?</span>
            <button className="btn btn-primary" disabled={busy} onClick={tidy}>
              Yes, tidy up
            </button>
            <button className="btn btn-outline" onClick={() => setConfirmTidy(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-outline btn-lg" disabled={busy} onClick={() => setConfirmTidy(true)}>
            Tidy up doubles
          </button>
        )}
        {tidyReport && (
          <ul>
            {tidyReport.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </section>

      {rows == null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing copied yet.</p>
      ) : (
        <ul className="flight-list">
          {rows.map((r) => (
            <li key={r.id} className="flight-item">
              <span className="flight-main">
                <span>
                  <strong>{KIND[r.kind] ?? r.kind}</strong> · {formatDay(r.created_at.slice(0, 10))} {formatTime(r.created_at)}
                </span>
                {r.done_at ? (
                  <span className="flight-gps has">✓ {r.note ?? 'copied'}</span>
                ) : r.last_error ? (
                  <span className="warn">
                    {r.attempts >= 10 ? 'Stopped trying: ' : `Retrying (${r.attempts}): `}
                    {r.last_error}
                  </span>
                ) : (
                  <span className="meta">Waiting</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
