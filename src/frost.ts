import { useEffect, useState } from 'react';

import { CENTRE } from './centre';

const LAT = CENTRE.lat;
const LON = CENTRE.lon;
const CACHE_KEY = 'smj-frost';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface FrostForecast {
  /** Lowest temperature from now until 10am tomorrow, °C */
  low: number;
  /** When that low is expected (ISO, local time) */
  lowAt: string;
  fetchedAt: number;
}

function readCache(): FrostForecast | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as FrostForecast | null;
    return c && Date.now() - c.fetchedAt < 6 * MAX_AGE_MS ? c : null;
  } catch {
    return null;
  }
}

/** Tonight's low from the free Open-Meteo forecast (no key). Cached; works offline with the last result. */
export function useTonightLow(): FrostForecast | null {
  const [forecast, setForecast] = useState<FrostForecast | null>(readCache);

  useEffect(() => {
    if (forecast && Date.now() - forecast.fetchedAt < MAX_AGE_MS) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m&timezone=Europe%2FLondon&forecast_days=2`;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { hourly: { time: string[]; temperature_2m: number[] } }) => {
        // Times are London local ("2026-10-05T03:00"); look from this hour to 10am tomorrow
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        const from = local(now);
        const to = local(tomorrow);
        let low = Infinity;
        let lowAt = '';
        data.hourly.time.forEach((t, i) => {
          if (t >= from && t <= to && data.hourly.temperature_2m[i] < low) {
            low = data.hourly.temperature_2m[i];
            lowAt = t;
          }
        });
        if (!Number.isFinite(low) || cancelled) return;
        const next = { low: Math.round(low * 10) / 10, lowAt, fetchedAt: Date.now() };
        setForecast(next);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* no signal or service down: keep whatever we had */
      });
    return () => {
      cancelled = true;
    };
  }, [forecast]);

  return forecast;
}
