import { useState } from 'react';
import Papa from 'papaparse';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { WEEKDAYS } from '../time';
import { formatWeight } from '../weight';
import { aviaryKey, aviaryLabel } from '../aviary';
import { CSV_COLUMNS, planImport, type Plan } from './csv';

export function ImportCsv() {
  const { birds, aviaries, refresh } = useStore();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => setPlan(planImport(res.data, birds, aviaries)),
    });
  }

  function downloadTemplate() {
    const example = ['Willow', 'Red Kite', 'F', 'Kite Pen', '4', 'chick', '2 ×', '1', 'Sun', 'lb/oz', '2lb 1oz', '2lb 5oz', 'Nervous of dogs', 'active'];
    const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: [example] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'smj-birds-template.csv';
    a.click();
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    const failures: string[] = [];

    const aviaryIds = new Map(aviaries.map((a) => [aviaryKey(a.name, a.number), a.id]));
    for (const a of plan.newAviaries) {
      const { data, error } = await supabase.from('aviaries').insert(a).select('id').single();
      if (error) failures.push(`Aviary ${aviaryLabel(a)}: ${error.message}`);
      else aviaryIds.set(aviaryKey(a.name, a.number), data.id);
    }

    let added = 0;
    let updated = 0;
    for (const row of plan.rows) {
      if (row.action === 'error') continue;
      const fields: Record<string, unknown> = { ...row.fields };
      if (row.aviaryName) fields.aviary_id = aviaryIds.get(aviaryKey(row.aviaryName, row.aviaryNumber)) ?? null;
      const { error } =
        row.action === 'update'
          ? await supabase.from('birds').update(fields).eq('id', row.existingId!)
          : await supabase.from('birds').insert({ name: row.name, ...fields });
      if (error) failures.push(`${row.name}: ${error.message}`);
      else if (row.action === 'update') updated++;
      else added++;
    }

    await refresh();
    setBusy(false);
    setPlan(null);
    setResult(
      `${added} added, ${updated} updated, ${plan.newAviaries.length} aviaries created.` + (failures.length ? `\nProblems:\n${failures.join('\n')}` : ''),
    );
  }

  const counts = plan && {
    add: plan.rows.filter((r) => r.action === 'add').length,
    update: plan.rows.filter((r) => r.action === 'update').length,
    error: plan.rows.filter((r) => r.action === 'error').length,
  };

  return (
    <div>
      <h1 className="page-title">Import birds</h1>
      <p className="muted">
        Birds are matched by name. Existing birds are updated, and <strong>blank cells leave the current value unchanged</strong>. Each aviary is a <strong>section + number</strong> (e.g. Mews 5); new ones are created automatically. Fast days are written like <code>Sun</code> or <code>Mon;Thu</code>. Put <code>g</code> or <code>lb/oz</code> in weight_unit, and write targets in that unit, e.g. <code>650</code> or <code>2lb 3oz</code>.
      </p>
      <button className="btn btn-outline btn-lg" onClick={downloadTemplate}>
        Download template
      </button>
      <label className="field">
        <span>CSV file</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {result && <pre className="panel result">{result}</pre>}

      {plan && counts && (
        <>
          <div className="panel">
            <strong>{fileName}</strong>: {counts.add} new, {counts.update} to update
            {counts.error > 0 && <span className="warn-text">, {counts.error} with problems (will be skipped)</span>}
            {plan.newAviaries.length > 0 && <div>New aviaries: {plan.newAviaries.map(aviaryLabel).join(', ')}</div>}
          </div>
          <div className="table-wrap">
            <table className="preview">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Bird</th>
                  <th>Action</th>
                  <th>Aviary</th>
                  <th>Feed</th>
                  <th>Fast</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.line} className={`row-${r.action}`}>
                    <td>{r.line}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.action === 'error' ? r.errors.join('; ') : r.action}</td>
                    <td>{r.aviaryName ? aviaryLabel({ name: r.aviaryName, number: r.aviaryNumber ?? null }) : ''}</td>
                    <td>{[r.fields.default_portion, r.fields.default_food].filter(Boolean).join(' ')}</td>
                    <td>{r.fields.fast_days?.map((d) => WEEKDAYS[d - 1]).join(' ')}</td>
                    <td>{r.fields.target_weight_min != null || r.fields.target_weight_max != null ? `${formatWeight(r.fields.target_weight_min ?? null, r.unit)} – ${formatWeight(r.fields.target_weight_max ?? null, r.unit)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary btn-xl" disabled={busy || counts.add + counts.update === 0} onClick={apply}>
            {busy ? 'Importing…' : `Import ${counts.add + counts.update} birds`}
          </button>
        </>
      )}
    </div>
  );
}
