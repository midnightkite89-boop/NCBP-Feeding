import { useState } from 'react';
import { DEFAULT_FOOD, FOOD_PARTS, FOODS, QTY_MAX, QTY_MIN, QTY_STEP, feedLabel, formatQty, isMenuFood, joinFood, splitFood, type FeedItem } from '../food';

/** Big food buttons; Rabbit and Pheasant then show their cuts; "Other" opens a box to type the food. */
export function FoodPicker({ label = 'Food', value, onChange }: { label?: string; value: string; onChange: (food: string) => void }) {
  const [other, setOther] = useState(!!value && !isMenuFood(value));
  const picked = other ? null : splitFood(value);
  const cuts = picked ? FOOD_PARTS[picked.base] : undefined;
  function toggleCut(cut: string) {
    if (!picked) return;
    const has = picked.parts.includes(cut);
    // "whole" stands alone; picking a cut clears "whole"
    const parts = has ? picked.parts.filter((p) => p !== cut) : cut === 'whole' ? ['whole'] : [...picked.parts.filter((p) => p !== 'whole'), cut];
    onChange(joinFood(picked.base, parts));
  }
  return (
    <div className="field">
      <span>{label}</span>
      <div className="food-grid" role="radiogroup" aria-label={label}>
        {FOODS.map((f) => {
          const on = !other && picked?.base === f;
          return (
            <button
              type="button"
              key={f}
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              onClick={() => {
                setOther(false);
                if (picked?.base !== f) onChange(f);
              }}
            >
              {f}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={other}
          className={other ? 'on' : ''}
          onClick={() => {
            setOther(true);
            if (isMenuFood(value)) onChange('');
          }}
        >
          Other
        </button>
      </div>
      {cuts && picked && (
        <div className="food-cuts" role="group" aria-label={`${picked.base} – which part (tick all given)`}>
          {cuts.map((c) => {
            const on = picked.parts.includes(c);
            return (
              <button type="button" key={c} aria-pressed={on} className={on ? 'on' : ''} onClick={() => toggleCut(c)}>
                {on ? '✓ ' : ''}
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            );
          })}
        </div>
      )}
      {other && (
        <input className="food-other" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type the food" aria-label="Other food" autoFocus />
      )}
    </div>
  );
}

/** − 1½ + in half steps, sized for a thumb. */
export function QtyStepper({ label = 'How many', value, onChange }: { label?: string; value: number; onChange: (n: number) => void }) {
  const step = (d: number) => onChange(Math.min(QTY_MAX, Math.max(QTY_MIN, value + d)));
  return (
    <div className="field">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => step(-QTY_STEP)} disabled={value <= QTY_MIN} aria-label="Half less">
          −
        </button>
        <output aria-live="polite">{formatQty(value)}</output>
        <button type="button" onClick={() => step(QTY_STEP)} disabled={value >= QTY_MAX} aria-label="Half more">
          +
        </button>
      </div>
    </div>
  );
}

/**
 * One or more foods in a feed, e.g. a rabbit leg then 2 chicks. One food is
 * edited at a time; the others show as chips above it.
 */
export function FeedItemsEditor({
  items,
  active,
  onActive,
  onChange,
  showQty = true,
}: {
  items: FeedItem[];
  active: number;
  onActive: (i: number) => void;
  onChange: (items: FeedItem[]) => void;
  /** False where the amount is set elsewhere (the − / + beside FED in round mode) */
  showQty?: boolean;
}) {
  const current = items[Math.min(active, items.length - 1)];
  const setCurrent = (patch: Partial<FeedItem>) => onChange(items.map((it, i) => (i === active ? { ...it, ...patch } : it)));
  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
    onActive(Math.max(0, i <= active ? active - 1 : active));
  }
  return (
    <div className="feed-items">
      {items.length > 1 && (
        <div className="feed-chips">
          {items.map((it, i) => (
            <span key={i} className={`feed-chip${i === active ? ' on' : ''}`}>
              <button type="button" onClick={() => onActive(i)} aria-pressed={i === active}>
                {feedLabel(formatQty(it.qty), it.food) || 'Choose food'}
              </button>
              <button type="button" className="feed-chip-x" onClick={() => remove(i)} aria-label={`Remove ${it.food || 'this food'}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <FoodPicker key={active} value={current.food} onChange={(food) => setCurrent({ food })} />
      {showQty && <QtyStepper value={current.qty} onChange={(qty) => setCurrent({ qty })} />}
      <button
        type="button"
        className="btn btn-outline feed-add"
        onClick={() => {
          onChange([...items, { food: DEFAULT_FOOD, qty: 1 }]);
          onActive(items.length);
        }}
      >
        + Add another food
      </button>
    </div>
  );
}
