import { useEffect, useState } from 'react';
import { sumFeeds } from '../food';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { addDays } from '../time';
import type { Bird, FeedLog } from '../types';

// Yesterday's feeds, fetched once per day and shared by every stop on the round
let cache: { date: string; logs: FeedLog[] } | null = null;
let pending: Promise<FeedLog[]> | null = null;

function loadYesterday(date: string): Promise<FeedLog[]> {
  if (cache?.date === date) return Promise.resolve(cache.logs);
  pending ??= Promise.resolve(
    supabase.from('feed_logs').select('bird_id, status, food_type, amount, notes').eq('log_date', date).in('status', ['fed', 'left', 'fasting']).is('voided_at', null),
  ).then(({ data }) => {
    cache = { date, logs: (data as FeedLog[]) ?? [] };
    pending = null;
    return cache.logs;
  });
  return pending;
}

/** "Yesterday: 33 Chick · left 2 Chick" for a bird or a shared aviary; nothing offline or if nothing was logged */
export function YesterdayLine({ birds }: { birds: Bird[] }) {
  const { today } = useStore();
  const date = addDays(today, -1);
  const [logs, setLogs] = useState<FeedLog[] | null>(cache?.date === date ? cache.logs : null);
  useEffect(() => {
    let live = true;
    loadYesterday(date).then((l) => live && setLogs(l)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [date]);
  if (!logs) return null;
  const ids = new Set(birds.map((b) => b.id));
  const mine = logs.filter((l) => ids.has(l.bird_id));
  if (mine.length === 0) return null;
  const fed = sumFeeds(mine.filter((l) => l.status === 'fed'));
  const left = sumFeeds(mine.filter((l) => l.status === 'left'));
  const fasting = mine.some((l) => l.status === 'fasting');
  return (
    <p className="yesterday-line">
      <strong>Yesterday:</strong> {fed || (fasting ? 'fasting' : 'not fed')}
      {left && <span className="yesterday-left"> · left {left}</span>}
    </p>
  );
}
