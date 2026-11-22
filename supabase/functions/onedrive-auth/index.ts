// onedrive-auth: connects the app to the centre's OneDrive.
//
//   POST (from the app, by an admin)  -> returns Microsoft's sign-in address to send them to
//   GET ?code&state (from Microsoft)  -> swaps the code for a lasting permission, finds or makes
//                                        the folder, and sends the admin back to the app
//
// Deploy with "Verify JWT" OFF (Microsoft's redirect has no Supabase login; the POST checks it itself).
// Secrets (Supabase > Edge Functions > Secrets): MS_CLIENT_ID, MS_CLIENT_SECRET, APP_URL
// (e.g. https://ncbp-app.netlify.app). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SCOPES = 'offline_access Files.ReadWrite User.Read';
const MS = 'https://login.microsoftonline.com/common/oauth2/v2.0';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/onedrive-auth`;
const appPage = (query: string) => `${Deno.env.get('APP_URL') ?? 'https://ncbp-app.netlify.app'}/admin/onedrive?${query}`;
const back = (query: string) => new Response(null, { status: 302, headers: { Location: appPage(query) } });

/** Step 1: an admin taps Connect; hand back Microsoft's Allow page for them to go to */
async function start(req: Request): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data } = await db.auth.getUser(token);
  if (!data.user) return Response.json({ error: 'Sign in to the app first.' }, { status: 401, headers: CORS });
  const { data: me } = await db.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (me?.role !== 'admin') return Response.json({ error: 'Only an admin can connect OneDrive.' }, { status: 403, headers: CORS });

  const state = crypto.randomUUID();
  await db.from('onedrive_states').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString());
  await db.from('onedrive_states').insert({ state, user_id: data.user.id });
  const url = `${MS}/authorize?${new URLSearchParams({
    client_id: Deno.env.get('MS_CLIENT_ID')!,
    response_type: 'code',
    redirect_uri: callback,
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  })}`;
  return Response.json({ url }, { headers: CORS });
}

/** Step 2: Microsoft sends them back here after Allow */
async function finish(url: URL): Promise<Response> {
  if (url.searchParams.get('error')) return back(`error=${encodeURIComponent(url.searchParams.get('error_description') ?? 'Not allowed')}`);
  const state = url.searchParams.get('state') ?? '';
  const { data: saved } = await db.from('onedrive_states').select('state, created_at').eq('state', state).maybeSingle();
  await db.from('onedrive_states').delete().eq('state', state);
  if (!saved || Date.now() - Date.parse(saved.created_at) > 15 * 60_000) return back('error=That+link+expired.+Tap+Connect+again.');

  const res = await fetch(`${MS}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('MS_CLIENT_ID')!,
      client_secret: Deno.env.get('MS_CLIENT_SECRET')!,
      grant_type: 'authorization_code',
      code: url.searchParams.get('code') ?? '',
      redirect_uri: callback,
      scope: SCOPES,
    }),
  });
  const tokens = await res.json();
  if (!res.ok || !tokens.refresh_token) return back(`error=${encodeURIComponent(tokens.error_description?.split('\n')[0] ?? 'Microsoft sign-in failed')}`);

  const graph = (path: string, init: RequestInit = {}) =>
    fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' } });

  const profile = await (await graph('/me')).json();
  const account = profile.mail ?? profile.userPrincipalName ?? profile.displayName ?? 'OneDrive';

  // The folder, in the root of their OneDrive: found if it's there, made if not
  const { data: settings } = await db.from('onedrive_settings').select('folder_name').eq('id', 1).single();
  const name = settings?.folder_name?.trim() || 'NCBP Bird Care App';
  let folder = await graph(`/me/drive/root:/${encodeURIComponent(name)}`);
  if (folder.status === 404)
    folder = await graph('/me/drive/root/children', { method: 'POST', body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
  if (!folder.ok) return back(`error=${encodeURIComponent(`Couldn't open the folder "${name}" (${folder.status})`)}`);
  const folderId = (await folder.json()).id as string;

  await db.from('onedrive_tokens').upsert({ id: 1, refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() });
  await db.from('onedrive_settings').update({ account, folder_id: folderId, connected_at: new Date().toISOString(), last_error: null }).eq('id', 1);
  return back('connected=1');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method === 'POST') return await start(req);
    return await finish(new URL(req.url));
  } catch (e) {
    return back(`error=${encodeURIComponent(String((e as Error).message ?? e).slice(0, 200))}`);
  }
});
