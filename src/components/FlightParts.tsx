import { useState } from 'react';
import { FoodPicker, QtyStepper } from './FoodPicker';
import { formatQty } from '../food';
import { hhmm, todayAt } from '../flight';

export interface GloveFeedValue {
  on: boolean;
  food: string;
  qty: number;
  /** The glove feed was only part of today's food */
  moreLater: boolean;
}

export function useGloveFeed(defaultFood: string): [GloveFeedValue, (v: GloveFeedValue) => void] {
  return useState<GloveFeedValue>({ on: false, food: defaultFood, qty: 1, moreLater: true });
}

/** "Fed on the glove" — tick it to log food given during the flight */
export function GloveFeed({ value, onChange }: { value: GloveFeedValue; onChange: (v: GloveFeedValue) => void }) {
  return (
    <div className={`glove ${value.on ? 'on' : ''}`}>
      <label className="check">
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        <span>Fed on the glove</span>
      </label>
      {value.on && (
        <>
          <FoodPicker value={value.food} onChange={(food) => onChange({ ...value, food })} />
          <QtyStepper value={value.qty} onChange={(qty) => onChange({ ...value, qty })} />
          <label className="check">
            <input type="checkbox" checked={value.moreLater} onChange={(e) => onChange({ ...value, moreLater: e.target.checked })} />
            <span>Still needs feeding later today</span>
          </label>
        </>
      )}
    </div>
  );
}

export function gloveAmount(v: GloveFeedValue): string {
  return formatQty(v.qty);
}

/** Time of the flight: starts at now, nudge ±15 min (today only, not the future) */
export function FlightTime({ time, onChange }: { time: string; onChange: (t: string) => void }) {
  function nudge(minutes: number) {
    const d = todayAt(time) ?? new Date();
    d.setMinutes(d.getMinutes() + minutes);
    const now = new Date();
    if (d.getDate() !== now.getDate()) return;
    onChange(hhmm(d.getTime() > now.getTime() ? now : d));
  }
  return (
    <div className="flight-time">
      <span className="flight-time-label">Time</span>
      <button type="button" className="btn btn-outline" onClick={() => nudge(-15)} aria-label="15 minutes earlier">
        −15
      </button>
      <input type="time" value={time} onChange={(e) => onChange(e.target.value)} aria-label="Time flown" />
      <button type="button" className="btn btn-outline" onClick={() => nudge(15)} aria-label="15 minutes later">
        +15
      </button>
      <button type="button" className="btn btn-outline" onClick={() => onChange(hhmm(new Date()))}>
        Now
      </button>
    </div>
  );
}
