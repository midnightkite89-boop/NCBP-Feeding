// Weights are always stored in grams. Birds weighed in pounds and ounces are
// converted on the way in and shown back in lb/oz.

export type WeightUnit = 'g' | 'lb_oz';

export const GRAMS_PER_OZ = 28.349523125;

export function lbOzToGrams(lb: number, oz: number): number {
  return Math.round((lb * 16 + oz) * GRAMS_PER_OZ * 10) / 10;
}

export function gramsToLbOz(grams: number): { lb: number; oz: number } {
  // Round to the nearest 0.01 oz so a value typed in lb/oz reads back the same.
  const totalOz = Math.round((grams / GRAMS_PER_OZ) * 100) / 100;
  const lb = Math.floor(totalOz / 16);
  return { lb, oz: Math.round((totalOz - lb * 16) * 100) / 100 };
}

export function formatWeight(grams: number | null, unit: WeightUnit | null | undefined): string {
  if (grams == null) return '—';
  if (unit !== 'lb_oz') return `${grams} g`;
  const { lb, oz } = gramsToLbOz(grams);
  return lb > 0 ? `${lb} lb ${oz} oz` : `${oz} oz`;
}

/**
 * Reads a typed weight in the given unit and returns grams.
 * lb/oz accepts "2lb 3oz", "2 lb 3.5 oz", "2:3", "35oz" or "35" (ounces).
 * Returns null for blank, or an error message.
 */
export function parseWeight(text: string, unit: WeightUnit): number | null | string {
  const s = text.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  if (unit === 'g') {
    const n = Number(s.replace(/\s*g$/, ''));
    return Number.isFinite(n) && n > 0 ? n : `"${text}" is not a weight in grams`;
  }
  const colon = s.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (colon) return lbOzToGrams(Number(colon[1]), Number(colon[2]));
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?))?\s*(?:(\d+(?:\.\d+)?)\s*(?:oz|ounces?)?)?$/);
  if (m && (m[1] || m[2])) {
    const grams = lbOzToGrams(Number(m[1] ?? 0), Number(m[2] ?? 0));
    if (grams > 0) return grams;
  }
  return `"${text}" is not a weight in lb/oz (try "2lb 3oz")`;
}
