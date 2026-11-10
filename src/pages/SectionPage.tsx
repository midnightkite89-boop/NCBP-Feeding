import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BirdCard } from '../components/BirdCard';
import { routeSort } from '../aviary';
import { useStore } from '../store';
import { birdStatus, needsFeeding, quickFeedEntry } from '../status';
import { ScanTabs, useScanTab } from '../components/ScanTabs';
import { AviaryCleanRow, BathsCheckedButton, CleanSheet, DailySectionCard } from '../components/Care';
import { aviaryCleanState, bathStatus, birdCheckToday, isDailySection } from '../care';

/** Every bird in one section (e.g. the Mews), in feeding order. Opened by a section QR code. */
export function SectionPage() {
  const { name = '' } = useParams();
  const { aviaries, birds, todayLogs, today, logFeeds, loading, careLogs, careSettings, logCare } = useStore();
  const [tab, setTab] = useScanTab();
  const [bulkClean, setBulkClean] = useState(false);
  const wanted = decodeURIComponent(name).toLowerCase();
  const inSection = aviaries.filter((a) => a.name.trim().toLowerCase() === wanted);

  if (loading) return <p className="empty">Loading…</p>;
  if (inSection.length === 0)
    return (
      <p className="empty">
        This QR code doesn't match a section. <Link to="/">Go to Today</Link>
      </p>
    );

  const title = inSection[0].name;
  const ids = new Set(inSection.map((a) => a.id));
  const here = routeSort(
    birds.filter((b) => b.status === 'active' && b.aviary_id && ids.has(b.aviary_id)),
    aviaries,
  );
  const hungry = here
    .map((b) => ({ bird: b, status: birdStatus(b, todayLogs.filter((l) => l.bird_id === b.id), today) }))
    .filter((x) => needsFeeding(x.status.state));

  const unchecked = here.filter((b) => !birdCheckToday(b.id, careLogs, today));
  function checkAll() {
    if (!window.confirm(`Log all ${unchecked.length} birds in ${title} as checked, with no concerns?`)) return;
    logCare(
      unchecked.map((b) => ({ kind: 'bird_check' as const, bird_id: b.id })),
      `${unchecked.length} birds checked in ${title}`,
    );
  }
  const daily = isDailySection(title, careSettings);
  const sectionAviaries = inSection
    .filter((a) => !a.archived && here.some((b) => b.aviary_id === a.id))
    .sort((x, y) => here.findIndex((b) => b.aviary_id === x.id) - here.findIndex((b) => b.aviary_id === y.id));
  const notClean = sectionAviaries.filter((a) => aviaryCleanState(a, careLogs, today, careSettings).state !== 'ok');
  const bathsToCheck = sectionAviaries.filter((a) => {
    const b = bathStatus(a, careLogs, today, careSettings);
    return !!b && b.check.state !== 'ok';
  });

  function feedAll() {
    if (!window.confirm(`Log all ${hungry.length} birds still to feed in ${title} as fed with their usual food?`)) return;
    logFeeds(
      hungry.map(({ bird, status }) => quickFeedEntry(bird, status)),
      `${hungry.length} birds fed in ${title}`,
      { alsoCheck: true },
    );
  }

  return (
    <div className="aviary-page">
      <h1 className="page-title">{title}</h1>
      <p className="muted">
        {here.length} bird{here.length === 1 ? '' : 's'} · {hungry.length === 0 ? 'all done' : `${hungry.length} still to feed`}
      </p>
      <ScanTabs tab={tab} onChange={setTab} />
      {tab === 'clean' ? (
        daily ? (
          <>
            <DailySectionCard section={title} count={here.length} />
            <BathsCheckedButton aviaries={bathsToCheck} label={title} />
          </>
        ) : (
          <>
            <BathsCheckedButton aviaries={bathsToCheck} label={title} />
            {notClean.length >= 2 && (
              <button className="btn btn-primary btn-xl feed-all" onClick={() => setBulkClean(true)}>
                All {notClean.length} due cleaned
              </button>
            )}
            {sectionAviaries.map((a) => (
              <AviaryCleanRow key={a.id} aviary={a} birds={here.filter((b) => b.aviary_id === a.id)} />
            ))}
            {bulkClean && <CleanSheet aviaries={notClean} section={title} onClose={() => setBulkClean(false)} />}
          </>
        )
      ) : (
        <>
      {unchecked.length >= 2 && (
        <button className="btn btn-outline btn-lg feed-all" onClick={checkAll}>
          ✓ All checked, no concerns ({unchecked.length})
        </button>
      )}
      {hungry.length >= 2 && (
        <button className="btn btn-feed btn-xl feed-all" onClick={feedAll}>
          <span className="btn-main">ALL FED ({hungry.length})</span>
          <span className="btn-sub">each bird's usual food or top-up</span>
        </button>
      )}
      {here.map((b) => (
        <BirdCard key={b.id} bird={b} detailed />
      ))}
        </>
      )}
      <Link to="/" className="btn btn-outline btn-lg back-link">
        ← All birds
      </Link>
    </div>
  );
}
