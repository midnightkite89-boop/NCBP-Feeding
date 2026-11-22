import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';

interface Settings {
  folder_name: string;
  account: string | null;
  connected_at: string | null;
  last_run_at: string | null;
  last_copied: number | null;
  last_error: string | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

/**
 * Admin: connect the centre's OneDrive (one Microsoft sign-in and "Allow"), see when it last
 * copied, and copy now. Health check PDFs, feed sheets and breeding records go into one folder.
 */
export function OneDriveAdmin() {
  const [params] = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(
    params.get('connected') ? 'Connected. Tap Copy now to make the first copy (tap again until it says it has finished); after that it copies every night.' : params.get('error') ? `Not connected: ${params.get('error')}` : null,
  );

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('onedrive_settings').select('*').eq('id', 1).maybeSingle();
    if (error) setMsg('OneDrive settings need a signal to load.');
    if (data) {
      setSettings(data as Settings);
      setFolder((data as Settings).folder_name);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy('connect');
    setMsg(null);
    if (settings && folder.trim() && folder.trim() !== settings.folder_name) await supabase.from('onedrive_settings').update({ folder_name: folder.trim() }).eq('id', 1);
    const { data, error } = await supabase.functions.invoke('onedrive-auth', { body: {} });
    setBusy(null);
    if (error || !data?.url) return setMsg(data?.error ?? "Couldn't reach the OneDrive connector. Has it been set up in Supabase yet?");
    window.location.href = data.url as string;
  }

  async function copyNow() {
    setBusy('copy');
    setMsg(null);
    const { data, error } = await supabase.functions.invoke('onedrive-sync', { body: {} });
    setBusy(null);
    if (error) setMsg(`Copy failed. ${data?.error ?? 'See the error below.'}`);
    else
      setMsg(
        `Done: ${data.copied} file${data.copied === 1 ? '' : 's'} copied, ${data.skipped} already up to date.` +
          (data.more ? ' There is more to copy: tap Copy now again (or it carries on tonight).' : ' Everything is up to date.'),
      );
    await load();
  }

  const connected = !!settings?.connected_at;
  return (
    <div className="onedrive-page">
      <h1 className="page-title">OneDrive copying</h1>
      <p className="muted">
        Every night the app copies its records into one OneDrive folder. Each bird has its own folder with its bird record, a health and vet
        log (issues, medication, every dose), its health checks (a PDF each, like the paper form) and its photos. Alongside them: one weekly
        records sheet for every bird (weight when weighed, fed, food left) and the breeding records. Staff and inspectors can find them there, and
        they stay yours even without the app.
      </p>
      {msg && <p className={msg.startsWith('Not') || msg.startsWith('Copy failed') || msg.startsWith("Couldn't") ? 'warn' : 'ok-note'}>{msg}</p>}

      <section className="panel">
        <h2>{connected ? 'Connected' : 'Not connected yet'}</h2>
        {connected ? (
          <p>
            Copying into <strong>{settings?.folder_name}</strong> in <strong>{settings?.account}</strong>'s OneDrive. Connected {when(settings!.connected_at)}.
          </p>
        ) : (
          <p className="muted">Whoever owns the OneDrive signs in once with Microsoft and taps Allow. Microsoft's screen asks for access to their OneDrive files; the app only ever reads and writes inside this one folder.</p>
        )}
        <label className="field">
          <span>Folder (in the top level of the OneDrive)</span>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="NCBP Bird Care App" />
          <small>Found if it's already there, made if not. Change it before connecting.</small>
        </label>
        <button className={`btn ${connected ? 'btn-outline' : 'btn-primary'} btn-lg`} disabled={busy != null} onClick={() => void connect()}>
          {busy === 'connect' ? 'Opening Microsoft…' : connected ? 'Connect a different account' : 'Connect OneDrive'}
        </button>
      </section>

      {connected && (
        <section className="panel">
          <h2>Copying</h2>
          <p>
            Last run: <strong>{when(settings!.last_run_at)}</strong>
            {settings?.last_copied != null && ` · ${settings.last_copied} file${settings.last_copied === 1 ? '' : 's'} copied`}
          </p>
          {settings?.last_error && <p className="warn">Last problem: {settings.last_error}</p>}
          <button className="btn btn-outline btn-lg" disabled={busy != null} onClick={() => void copyNow()}>
            {busy === 'copy' ? 'Copying…' : 'Copy now'}
          </button>
        </section>
      )}
    </div>
  );
}
