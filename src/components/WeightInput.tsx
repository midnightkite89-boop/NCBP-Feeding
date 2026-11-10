import { useRef, useState } from 'react';
import { gramsToLbOz, lbOzToGrams, type WeightUnit } from '../weight';

/**
 * Weight entry in the bird's own unit. Reports grams (or null when blank), and
 * `invalid` when what's typed can't be a weight.
 */
export function WeightInput({
  label,
  hint,
  unit,
  grams,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  unit: WeightUnit;
  grams: number | null;
  placeholder?: string;
  onChange: (grams: number | null, invalid: boolean) => void;
}) {
  const start = grams != null && unit === 'lb_oz' ? gramsToLbOz(grams) : null;
  const [g, setG] = useState(grams != null && unit === 'g' ? String(grams) : '');
  const [lb, setLb] = useState(start ? String(start.lb) : '');
  const [oz, setOz] = useState(start ? String(start.oz) : '');

  const ozBox = useRef<HTMLInputElement>(null);
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);

  function emitGrams(text: string) {
    setG(text);
    const n = num(text);
    onChange(n, n != null && !(n > 0 && n < 20000));
  }

  function emitLbOz(lbText: string, ozText: string) {
    setLb(lbText);
    setOz(ozText);
    const l = num(lbText);
    const o = num(ozText);
    if (l == null && o == null) return onChange(null, false);
    const invalid = [l, o].some((v) => v != null && !(v >= 0 && Number.isFinite(v))) || (o != null && o >= 16) || (l ?? 0) + (o ?? 0) === 0;
    onChange(invalid ? null : lbOzToGrams(l ?? 0, o ?? 0), invalid);
  }

  if (unit === 'g')
    return (
      <label className="field">
        <span>
          {label} (g) {hint && <small>{hint}</small>}
        </span>
        <input value={g} onChange={(e) => emitGrams(e.target.value)} inputMode="decimal" placeholder={placeholder} />
      </label>
    );

  return (
    <div className="field">
      <span>
        {label} (lb / oz) {hint && <small>{hint}</small>}
      </span>
      <div className="lb-oz">
        <label>
          <input
            value={lb}
            onChange={(e) => {
              // One digit (a new one replaces the old), then straight on to the ounces
              const digit = e.target.value.replace(/\D/g, '').slice(-1);
              emitLbOz(digit, oz);
              if (digit) {
                ozBox.current?.focus();
                ozBox.current?.select();
              }
            }}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            placeholder={placeholder}
            aria-label={`${label} pounds`}
          />
          <span>lb</span>
        </label>
        <label>
          <input ref={ozBox} value={oz} onChange={(e) => emitLbOz(lb, e.target.value)} inputMode="decimal" aria-label={`${label} ounces`} />
          <span>oz</span>
        </label>
      </div>
    </div>
  );
}
