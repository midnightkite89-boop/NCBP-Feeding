import { useState } from 'react';
import { CLEAN_LABEL, agoText } from '../care';
import { aviaryLabel } from '../aviary';
import { AviaryCleanRow, BathsCard, BathsCheckedButton, ConcernList, DailySectionCard, FrostBanner } from '../components/Care';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store';
import { formatDay, WEEKDAYS, isoWeekday } from '../time';
import { useCleaning, type SectionCare } from '../useCleaning';

/** Cleaning round: today's list, daily sections, weekly aviary cleans, baths, concerns. */
export function Clean() {
  const { careLogs, today, loading, birds, addToCleanPlan, removeFromCleanPlan } = useStore();
  const c = useCleaning();
  const [onlyDue, setOnlyDue] = useState(false);
  const [adding, setAdding] = useState(false);

  if (loading) return <p className="empty">Loading…</p>;

  const toCheck = birds.filter((b) => b.status === 'active' && !careLogs.some((l) => l.kind === 'bird_check' && l.bird_id === b.id && l.log_date === today)).length;
  const notDone = c.overdue + c.dailyLeft.length;
  const listIds = new Set(c.planItems.map((x) => x.aviary.id));

  return (
    <div className="clean-page">
      <FrostBanner />
      <section className={`counter ${notDone === 0 ? 'counter-done' : 'counter-todo'}`}>
        <div className="counter-date">{formatDay(today)}</div>
        <div className="counter-big clean-counts">
          <span>{c.overdue} overdue</span> · <span>{c.due} due</span>
        </div>
        <div className="counter-sub">
          {c.dailyLeft.length > 0 ? `${c.dailyLeft.join(', ')} not cleaned today · ` : ''}
          {c.never > 0 ? `${c.never} not logged yet · ` : ''}
          {c.bathsToCheck.length + c.bathsToClean.length > 0 ? `baths: ${c.bathsToCheck.length} to check, ${c.bathsToClean.length} to clean · ` : ''}
          {toCheck} bird{toCheck === 1 ? '' : 's'} still to check
        </div>
      </section>

      <ConcernList />

      <section className="panel plan-card">
        <div className="section-head">
          <h2>Today's cleaning list</h2>
          <span className="muted">{c.planItems.length ? `${c.planItems.length - c.planLeft} of ${c.planItems.length} done` : ''}</span>
        </div>
        {c.rota.length > 0 && (
          <p className="muted">
            Rota for {WEEKDAYS[isoWeekday(today) - 1]}: {c.rota.join(', ')}
          </p>
        )}
        {c.planItems.length === 0 && <p className="muted">Nothing on the list yet. Tap Suggest to add the aviaries most in need, or add your own.</p>}
        {c.planItems.map((x) => (
          <AviaryCleanRow key={x.aviary.id} aviary={x.aviary} birds={x.birds} fromRota={c.planFromRota.has(x.aviary.id)} onRemove={() => removeFromCleanPlan(x.aviary.id)} />
        ))}
        <div className="bird-actions">
          <button className="btn btn-primary btn-lg" disabled={c.suggestions.length === 0} onClick={() => addToCleanPlan(c.suggestions.map((x) => x.aviary.id))}>
            {c.suggestions.length ? `Suggest ${c.suggestions.length}` : 'Nothing due to suggest'}
          </button>
          <button className="btn btn-outline btn-lg" onClick={() => setAdding(true)}>
            + Add aviary
          </button>
        </div>
      </section>

      <BathsCard />

      <label className="check">
        <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />
        <span>Only show what needs doing</span>
      </label>

      {c.sections.map((s) => (
        <SectionBlock key={s.section} s={s} onlyDue={onlyDue} />
      ))}

      {adding && (
        <Sheet title="Add to today's list" onClose={() => setAdding(false)}>
          <p className="muted">Tap the aviaries to clean today. Most overdue are marked red.</p>
          {c.sections
            .filter((s) => !s.daily)
            .map((s) => (
              <div key={s.section}>
                <p className="session-sub">{s.section}</p>
                <div className="pick-grid">
                  {s.aviaries.map((x) => {
                    const on = listIds.has(x.aviary.id);
                    return (
                      <button
                        key={x.aviary.id}
                        type="button"
                        className={`pick-chip pick-${x.clean.state}${on ? ' on' : ''}`}
                        aria-pressed={on}
                        onClick={() => (on ? removeFromCleanPlan(x.aviary.id) : addToCleanPlan([x.aviary.id]))}
                        title={`${CLEAN_LABEL[x.clean.state]} – cleaned ${agoText(x.clean.days)}`}
                      >
                        {on ? '✓ ' : ''}
                        {aviaryLabel(x.aviary)}
                        <small> {x.birds.map((b) => b.name).join(', ')}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          <button className="btn btn-primary btn-xl" onClick={() => setAdding(false)}>
            Done
          </button>
        </Sheet>
      )}
    </div>
  );
}

function SectionBlock({ s, onlyDue }: { s: SectionCare; onlyDue: boolean }) {
  const toCheck = s.aviaries.filter((x) => x.bathNeeds === 'check' || (x.bath && x.bath.check.state !== 'ok')).map((x) => x.aviary);
  if (s.daily)
    return (
      <>
        <DailySectionCard section={s.section} count={s.aviaries.reduce((n, x) => n + x.birds.length, 0)} />
        <BathsCheckedButton aviaries={toCheck} label={s.section} />
      </>
    );
  const rows = s.aviaries.filter((x) => !onlyDue || x.clean.state !== 'ok' || x.bathNeeds);
  if (rows.length === 0) return null;
  return (
    <section className="aviary-group">
      <h2 className="aviary-title">{s.section}</h2>
      <BathsCheckedButton aviaries={toCheck} label={s.section} />
      {rows.map((x) => (
        <AviaryCleanRow key={x.aviary.id} aviary={x.aviary} birds={x.birds} />
      ))}
    </section>
  );
}
