import { CENTRE } from '../centre';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../store';
import { aviaryLabel, compareAviaries, routeSort, sectionPath, sectionsInRouteOrder } from '../aviary';

type Size = 'standard' | 'small';

interface Label {
  key: string;
  kind: 'section' | 'aviary';
  title: string;
  path: string;
  names: string[];
}

const INDIVIDUAL_KEY = 'smj-qr-individual';
// Perched birds (the Mews) share one section code instead of individual labels
const DEFAULT_NO_INDIVIDUAL = ['mews'];

function readIndividual(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(INDIVIDUAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Printable QR labels: one per section (opens every bird in it) and, for
 * sections where each bird has its own aviary, one per aviary. The codes open
 * /s/<section> or /a/<aviary>, where feeding (and later cleaning) is logged,
 * so printed labels keep working as the app grows.
 */
export function QrSheet() {
  const { aviaries, birds, ferretCages } = useStore();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [size, setSize] = useState<Size>('standard');
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [individual, setIndividualState] = useState<Record<string, boolean>>(readIndividual);

  const wantsIndividual = (section: string) => individual[section.toLowerCase()] ?? !DEFAULT_NO_INDIVIDUAL.includes(section.toLowerCase());
  function setIndividual(section: string, on: boolean) {
    const next = { ...individual, [section.toLowerCase()]: on };
    setIndividualState(next);
    try {
      localStorage.setItem(INDIVIDUAL_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // Section label first, then that section's aviaries, all in feeding-round order
  const groups = useMemo(() => {
    const active = birds.filter((b) => b.status === 'active');
    const ordered = routeSort(active, aviaries);
    const stop = new Map<string, number>();
    ordered.forEach((b, i) => b.aviary_id && !stop.has(b.aviary_id) && stop.set(b.aviary_id, i));
    const live = aviaries.filter((a) => !a.archived && (includeEmpty || stop.has(a.id)));

    const sections = sectionsInRouteOrder(active, aviaries);
    for (const a of live) if (!sections.some((s) => s.toLowerCase() === a.name.toLowerCase())) sections.push(a.name);

    return sections.map((section) => {
      const inSection = live
        .filter((a) => a.name.toLowerCase() === section.toLowerCase())
        .sort((x, y) => (stop.get(x.id) ?? Infinity) - (stop.get(y.id) ?? Infinity) || compareAviaries(x, y));
      const namesIn = (ids: Set<string>) => ordered.filter((b) => b.aviary_id && ids.has(b.aviary_id)).map((b) => b.name);
      const sectionLabel: Label = {
        key: `s:${section.toLowerCase()}`,
        kind: 'section',
        title: section,
        path: sectionPath(section),
        names: namesIn(new Set(inSection.map((a) => a.id))),
      };
      const aviaryLabels: Label[] = inSection.map((a) => ({
        key: a.id,
        kind: 'aviary',
        title: aviaryLabel(a),
        path: `/a/${a.slug}`,
        names: namesIn(new Set([a.id])),
      }));
      return { section, sectionLabel, aviaryLabels };
    });
  }, [aviaries, birds, includeEmpty]);

  // One label for the ferrets page, if there are ferret cages
  const ferretLabel: Label | null = ferretCages.length
    ? { key: 'ferrets', kind: 'section', title: 'Ferrets', path: '/ferrets', names: ferretCages.map((c) => `${c.name} (${c.ferrets})`) }
    : null;
  const all: Label[] = [...groups.flatMap((g) => [g.sectionLabel, ...(wantsIndividual(g.section) ? g.aviaryLabels : [])]), ...(ferretLabel ? [ferretLabel] : [])];
  const chosen = all.filter((l) => !unticked.has(l.key));

  useEffect(() => {
    const every = [...groups.flatMap((g) => [g.sectionLabel, ...g.aviaryLabels]), ...(ferretLabel ? [ferretLabel] : [])];
    Promise.all(
      every.map(async (l) => [l.key, await QRCode.toDataURL(`${window.location.origin}${l.path}`, { width: 600, margin: 2, errorCorrectionLevel: 'Q' })] as const),
    ).then((pairs) => setCodes(Object.fromEntries(pairs)));
  }, [groups, ferretCages.length]);

  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      <div className="no-print">
        <h1 className="page-title">QR labels</h1>
        <p className="muted">
          A <strong>section label</strong> opens every bird in that section. An <strong>aviary label</strong> opens just that aviary. Both are in
          feeding-round order. The codes keep working if you renumber aviaries or move birds, and cleaning will use the same codes when it's added.
          Laminate them or use weatherproof labels.
        </p>

        <div className="segmented" role="radiogroup" aria-label="Label size">
          <button role="radio" aria-checked={size === 'standard'} className={size === 'standard' ? 'on' : ''} onClick={() => setSize('standard')}>
            Standard (6 per A4)
          </button>
          <button role="radio" aria-checked={size === 'small'} className={size === 'small' ? 'on' : ''} onClick={() => setSize('small')}>
            Small (12 per A4)
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={includeEmpty} onChange={(e) => setIncludeEmpty(e.target.checked)} />
          <span>Include empty aviaries</span>
        </label>

        <div className="section-head">
          <h2>
            {chosen.length} of {all.length} labels selected
          </h2>
          <span>
            <button className="btn btn-outline" onClick={() => setUnticked(new Set())}>
              All
            </button>{' '}
            <button className="btn btn-outline" onClick={() => setUnticked(new Set(all.map((l) => l.key)))}>
              None
            </button>
          </span>
        </div>
        <p className="muted">Untick any you don't need, e.g. to reprint one damaged label.</p>

        {ferretLabel && (
          <fieldset className="panel qr-section">
            <legend>Ferrets</legend>
            <label className="check">
              <input type="checkbox" checked={!unticked.has('ferrets')} onChange={() => toggle('ferrets')} />
              <span>
                Ferrets label <small className="muted">opens the Ferrets tab</small>
              </span>
            </label>
          </fieldset>
        )}
        {groups.map((g) => (
          <fieldset key={g.section} className="panel qr-section">
            <legend>{g.section}</legend>
            <label className="check">
              <input type="checkbox" checked={!unticked.has(g.sectionLabel.key)} onChange={() => toggle(g.sectionLabel.key)} />
              <span>
                Section label <small className="muted">all {g.sectionLabel.names.length} birds</small>
              </span>
            </label>
            <label className="check qr-individual-toggle">
              <input type="checkbox" checked={wantsIndividual(g.section)} onChange={(e) => setIndividual(g.section, e.target.checked)} />
              <span>Individual aviary labels{!wantsIndividual(g.section) && <small className="muted"> (off, e.g. perched birds)</small>}</span>
            </label>
            {wantsIndividual(g.section) && (
              <ul className="qr-pick">
                {g.aviaryLabels.map((l) => (
                  <li key={l.key}>
                    <label className="check">
                      <input type="checkbox" checked={!unticked.has(l.key)} onChange={() => toggle(l.key)} />
                      <span>
                        {l.title} <small className="muted">{l.names.join(', ') || 'empty'}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        ))}

        <button className="btn btn-primary btn-xl" disabled={chosen.length === 0} onClick={() => window.print()}>
          Print {chosen.length} label{chosen.length === 1 ? '' : 's'}
        </button>
        <h2 className="qr-preview-title">Preview</h2>
      </div>

      <div className={`qr-grid qr-${size}`}>
        {chosen.map((l) => (
          <div key={l.key} className={`qr-card qr-${l.kind}`}>
            {l.kind === 'section' && <div className="qr-kind">Section</div>}
            <div className="qr-name">{l.title}</div>
            {codes[l.key] && <img src={codes[l.key]} alt={`QR code for ${l.title}`} />}
            {l.names.length > 0 && (
              <div className="qr-birds">{l.key === 'ferrets' ? l.names.join(' · ') : l.kind === 'section' ? `${l.names.length} birds: ${l.names.join(', ')}` : l.names.join(' · ')}</div>
            )}
            <div className="qr-foot">{CENTRE.shortName} · scan for feeding &amp; care</div>
          </div>
        ))}
      </div>
    </div>
  );
}
