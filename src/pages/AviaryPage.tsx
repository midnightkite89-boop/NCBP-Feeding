import { useParams, Link } from 'react-router-dom';
import { BirdCard } from '../components/BirdCard';
import { useStore } from '../store';
import { birdStatus, needsFeeding, quickFeedEntry } from '../status';
import { aviaryLabel } from '../aviary';
import { ScanTabs, useScanTab } from '../components/ScanTabs';
import { AviaryCleanRow, DailySectionCard } from '../components/Care';
import { isDailySection } from '../care';

export function AviaryPage() {
  const { slug } = useParams();
  const { aviaries, birds, todayLogs, today, logFeeds, loading, careSettings } = useStore();
  const [tab, setTab] = useScanTab();
  const aviary = aviaries.find((a) => a.slug === slug);

  if (loading) return <p className="empty">Loading…</p>;
  if (!aviary)
    return (
      <p className="empty">
        This QR code doesn't match an aviary. <Link to="/">Go to Today</Link>
      </p>
    );

  const here = birds.filter((b) => b.aviary_id === aviary.id && b.status === 'active');
  const hungry = here
    .map((b) => ({ bird: b, status: birdStatus(b, todayLogs.filter((l) => l.bird_id === b.id), today) }))
    .filter((x) => needsFeeding(x.status.state));

  function feedAll() {
    logFeeds(
      hungry.map(({ bird, status }) => quickFeedEntry(bird, status)),
      `${hungry.length} birds fed in ${aviaryLabel(aviary!)}`,
      { alsoCheck: true },
    );
  }

  return (
    <div className="aviary-page">
      <h1 className="page-title">
        {aviary.name} {aviary.number != null && <span className="aviary-num">{aviary.number}</span>}
      </h1>
      {aviary.archived && <p className="warn">This aviary is archived.</p>}
      <ScanTabs tab={tab} onChange={setTab} />
      {tab === 'clean' ? (
        <>
          {aviary.cold_spot && <p className="cold-note">❄ Cold spot{aviary.cold_note ? `: ${aviary.cold_note}` : ''}. Check on frost nights.</p>}
          {isDailySection(aviary.name, careSettings) ? (
            <DailySectionCard section={aviary.name} count={birds.filter((b) => b.status === 'active' && aviaries.some((a) => a.id === b.aviary_id && a.name === aviary.name)).length} />
          ) : (
            <AviaryCleanRow aviary={aviary} birds={here} />
          )}
        </>
      ) : (
        <>
      {here.length === 0 && <p className="empty">No birds in this aviary.</p>}
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
