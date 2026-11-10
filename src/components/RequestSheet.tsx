import { useState } from 'react';
import { useStore } from '../store';
import { addDays } from '../time';
import { Sheet } from './Sheet';

type Expiry = 'cleared' | 'today' | 'date';

export function RequestSheet({ birdId, onClose }: { birdId?: string | null; onClose: () => void }) {
  const { birds, addRequest, today } = useStore();
  const [target, setTarget] = useState<string>(birdId ?? '');
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState<Expiry>('cleared');
  const [date, setDate] = useState(addDays(today, 1));
  const active = birds.filter((b) => b.status === 'active');

  function save() {
    if (!text.trim()) return;
    addRequest({
      bird_id: target || null,
      instruction: text.trim(),
      expires_on: expiry === 'cleared' ? null : expiry === 'today' ? today : date,
    });
    onClose();
  }

  return (
    <Sheet title="Special request" onClose={onClose}>
      <label className="field">
        <span>For</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Everyone (general notice)</option>
          {active.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Instruction</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. Half ration – flying tomorrow" autoFocus />
      </label>
      <div className="segmented" role="radiogroup" aria-label="Show until">
        {(
          [
            ['cleared', 'Until cleared'],
            ['today', 'Today only'],
            ['date', 'Until date'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} role="radio" aria-checked={expiry === value} className={expiry === value ? 'on' : ''} onClick={() => setExpiry(value)}>
            {label}
          </button>
        ))}
      </div>
      {expiry === 'date' && (
        <label className="field">
          <span>Show up to and including</span>
          <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      <button className="btn btn-primary btn-xl" disabled={!text.trim()} onClick={save}>
        Add request
      </button>
    </Sheet>
  );
}
