import { has } from './centre';
import { supabase } from './supabase';

let timer: number | undefined;
/** Ask the Drive copier to run soon (it also runs every few minutes by itself). Never throws. */
export function nudgeDriveSync() {
  if (!has('driveSync')) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void supabase.functions.invoke('drive-sync').catch(() => undefined);
  }, 3000);
}
