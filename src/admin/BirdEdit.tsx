import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BirdPhoto } from '../components/BirdPhoto';
import { nudgeDriveSync } from '../drive';
import { WeightInput } from '../components/WeightInput';
import { FoodPicker, QtyStepper } from '../components/FoodPicker';
import { defaultFeed } from '../status';
import { formatQty } from '../food';
import { aviaryLabel, compareAviaries } from '../aviary';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { WEEKDAYS } from '../time';
import { TEAM_LABEL, roundNames, type Bird } from '../types';

const BLANK: Omit<Bird, 'id'> = {
  name: '',
  species: null,
  sex: null,
  photo_path: null,
  aviary_id: null,
  target_weight_min: null,
  target_weight_max: null,
  weight_unit: 'g',
  default_food: null,
  default_portion: null,
  feeds_per_day: 1,
  fast_days: [],
  care_notes: null,
  route_order: null,
  status: 'active',
  team: 'flying',
};

export function BirdEdit() {
  const { id } = useParams();
  const { birds } = useStore();
  const existing = birds.find((b) => b.id === id);
  if (id !== 'new' && !existing) return <p className="empty">Bird not found.</p>;
  // Keyed so the form resets if the bird's data arrives after the page opens
  return <BirdForm key={existing?.id ?? 'new'} existing={existing} />;
}

function BirdForm({ existing }: { existing: Bird | undefined }) {
  const navigate = useNavigate();
  const { aviaries, refresh, careSettings } = useStore();
  const isNew = !existing;
  const [form, setForm] = useState<Omit<Bird, 'id'>>({ ...BLANK, ...existing });
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (v: string) => (v.trim() ? v.trim() : null);
  const [badWeight, setBadWeight] = useState({ min: false, max: false });
  const usual = defaultFeed({ ...form, id: '' } as Bird);
  const minAboveMax = form.target_weight_min != null && form.target_weight_max != null && form.target_weight_min > form.target_weight_max;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const birdId = existing?.id ?? crypto.randomUUID();
    let photo_path = form.photo_path;
    if (photo) {
      const blob = await resizeImage(photo, 800);
      photo_path = `${birdId}/${Date.now()}.jpg`;
      const up = await supabase.storage.from('bird-photos').upload(photo_path, blob, { contentType: 'image/jpeg' });
      if (up.error) {
        setBusy(false);
        return setError(`Photo upload failed: ${up.error.message}`);
      }
    }
    const row = { ...form, name: form.name.trim(), default_food: form.default_food?.trim() || null, photo_path };
    if (photo) nudgeDriveSync();
    const res = isNew ? await supabase.from('birds').insert({ id: birdId, ...row }) : await supabase.from('birds').update(row).eq('id', birdId);
    setBusy(false);
    if (res.error) return setError(res.error.code === '23505' ? 'There is already a bird with that name.' : res.error.message);
    await refresh();
    navigate('/admin/birds');
  }

  return (
    <form onSubmit={save}>
      <h1 className="page-title">{isNew ? 'Add bird' : `Edit ${existing!.name}`}</h1>

      {existing && <BirdPhoto bird={existing} size={120} />}
      <label className="field">
        <span>Photo</span>
        <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>

      <label className="field">
        <span>Name</span>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </label>
      <label className="field">
        <span>Species</span>
        <input value={form.species ?? ''} onChange={(e) => set('species', text(e.target.value))} />
      </label>
      <label className="field">
        <span>Sex</span>
        <select value={form.sex ?? ''} onChange={(e) => set('sex', (e.target.value || null) as Bird['sex'])}>
          <option value="">—</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
          <option value="U">Unknown</option>
        </select>
      </label>
      <label className="field">
        <span>Aviary</span>
        <select value={form.aviary_id ?? ''} onChange={(e) => set('aviary_id', e.target.value || null)}>
          <option value="">None</option>
          {[...aviaries]
            .sort(compareAviaries)
            .filter((a) => !a.archived || a.id === form.aviary_id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {aviaryLabel(a)}
              </option>
            ))}
        </select>
      </label>

      <fieldset className="panel">
        <legend>Feeding</legend>
        <FoodPicker label="Usual food" value={form.default_food ?? usual.food} onChange={(f) => set('default_food', f)} />
        <QtyStepper label="Usual amount" value={usual.qty} onChange={(n) => set('default_portion', formatQty(n))} />
        <label className="field">
          <span>Feeds per day</span>
          <input type="number" min={1} max={6} value={form.feeds_per_day} onChange={(e) => set('feeds_per_day', Math.max(1, Math.min(6, Number(e.target.value) || 1)))} />
        </label>
        <div className="field">
          <span>Fast days</span>
          <div className="day-picker">
            {WEEKDAYS.map((d, i) => {
              const n = i + 1;
              const on = form.fast_days.includes(n);
              return (
                <button
                  type="button"
                  key={d}
                  className={on ? 'on' : ''}
                  aria-pressed={on}
                  onClick={() => set('fast_days', on ? form.fast_days.filter((x) => x !== n) : [...form.fast_days, n].sort())}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        {roundNames(careSettings).length > 1 && (
          <div className="field">
            <span>Feeding round</span>
            <div className="segmented" role="radiogroup" aria-label="Feeding round">
              {roundNames(careSettings).map((n, i) => (
                <button type="button" key={n} role="radio" aria-checked={(form.feed_round ?? 1) === i + 1} className={(form.feed_round ?? 1) === i + 1 ? 'on' : ''} onClick={() => set('feed_round', i + 1)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <span>Team</span>
          <div className="segmented" role="radiogroup" aria-label="Team">
            {(['flying', 'resting', 'aviary'] as const).map((value) => (
              <button type="button" key={value} role="radio" aria-checked={(form.team ?? 'flying') === value} className={(form.team ?? 'flying') === value ? 'on' : ''} onClick={() => set('team', value)}>
                {TEAM_LABEL[value]}
              </button>
            ))}
          </div>
          <small className="muted">Only the flying team is on the Weigh tab. Resting birds and aviary birds aren't weighed.</small>
        </div>
        <div className="field">
          <span>Weighed in</span>
          <div className="segmented" role="radiogroup" aria-label="Weighed in">
            {(
              [
                ['g', 'Grams'],
                ['lb_oz', 'lb / oz'],
              ] as const
            ).map(([value, label]) => (
              <button type="button" key={value} role="radio" aria-checked={form.weight_unit === value} className={form.weight_unit === value ? 'on' : ''} onClick={() => set('weight_unit', value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Keyed on the unit so the boxes redraw in the new unit; the stored grams don't change */}
        <WeightInput
          key={`min-${form.weight_unit}`}
          label="Target min"
          unit={form.weight_unit}
          grams={form.target_weight_min}
          onChange={(g, invalid) => {
            set('target_weight_min', g);
            setBadWeight((b) => ({ ...b, min: invalid }));
          }}
        />
        <WeightInput
          key={`max-${form.weight_unit}`}
          label="Target max"
          unit={form.weight_unit}
          grams={form.target_weight_max}
          onChange={(g, invalid) => {
            set('target_weight_max', g);
            setBadWeight((b) => ({ ...b, max: invalid }));
          }}
        />
        {(badWeight.min || badWeight.max) && <p className="warn">Check the target weights.</p>}
        {minAboveMax && <p className="warn">Target min is bigger than target max.</p>}
      </fieldset>

      <label className="field">
        <span>Standing care notes</span>
        <textarea rows={3} value={form.care_notes ?? ''} onChange={(e) => set('care_notes', text(e.target.value))} />
      </label>
      <label className="field">
        <span>Google Drive folder link (optional)</span>
        <input type="url" value={form.drive_folder_url ?? ''} onChange={(e) => set('drive_folder_url', text(e.target.value))} placeholder="https://drive.google.com/drive/folders/…" />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.status === 'archived'} onChange={(e) => set('status', e.target.checked ? 'archived' : 'active')} />
        <span>Archived (hidden from feeding round, history kept)</span>
      </label>

      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy || badWeight.min || badWeight.max || minAboveMax}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

async function resizeImage(file: File, max: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', 0.85));
}
