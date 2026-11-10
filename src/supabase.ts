import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Demo mode only exists in the dev server: open the app with ?demo (or ?demo=reset to start
// again) and it runs on a pretend database in this browser, with no login and no real data
// touched. ?demo=off goes back to the real database. Never included in the live build.
const demo = import.meta.env.DEV && demoWanted();
const demoFetch = demo ? await import('./demo/fakeFetch') : null;
if (demoFetch) demoFetch.seedDemoSession();

function demoWanted(): boolean {
  try {
    const p = new URLSearchParams(location.search).get('demo');
    if (p === 'off') localStorage.removeItem('demo-mode');
    else if (p != null) localStorage.setItem('demo-mode', '1');
    return localStorage.getItem('demo-mode') === '1';
  } catch {
    return false;
  }
}

export const isDemo = Boolean(demoFetch);
export const configured = isDemo || Boolean(url && key);

export const supabase = demoFetch
  ? createClient(demoFetch.DEMO_URL, 'demo', {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: demoFetch.fakeFetch },
    })
  : createClient(url ?? 'http://localhost', key ?? 'missing', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
