import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BirdCard, BirdRow } from '../components/BirdCard';
import { RequestList } from '../components/RequestList';
import { RequestSheet } from '../components/RequestSheet';
import { ConcernList, FrostBanner } from '../components/Care';
import { DosesDue } from './Health';
import { dosesToday, photoStatus } from '../health';
import { birdCheckToday, openConcerns } from '../care';
import { useTonightLow } from '../frost';
import { useStore } from '../store';
import { useCleaning } from '../useCleaning';
import { birdStatus, needsFeeding } from '../status';
import { formatDay } from '../time';
import { aviaryLabel, routeSort, sectionPath, sectionRuns } from '../aviary';

const FILTER_KEY = 'smj-today-filter';
const VIEW_KEY = 'smj-today-view';

export function Today() {
  const { birds, aviaries, todayLogs, requests, today, loading, careLogs, careSettings, medications, doses, healthIssues, healthEntries } = useStore();
  const cleaning = useCleaning();
  const forecast = useTonightLow();
  const [panel, setPanel] = useState<'concerns' | 'requests' | 'frost' | 'meds' | null>(null);
  const [view, setViewState] = useState<'rows' | 'cards'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'rows';
    } catch {
      return 'rows';
    }
  });
  function setView(v: 'rows' | 'cards') {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }
  const [filter, setFilterState] = useState<'all' | 'todo'>(() => {
    try {
      return localStorage.getItem(FILTER_KEY) === 'todo' ? 'todo' : 'all';
    } catch {
      return 'all';
    }
  });
  const [addingRequest, setAddingRequest] = useState(false);
  const [search, setSearch] = useState('');

  function setFilter(f: 'all' | 'todo') {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* ignore */
    }
  }

  const active = birds.filter((b) => b.status === 'active');
  const states = useMemo(() => {
    const m = new Map<string, ReturnType<typeof birdStatus>['state']>();
    for (const b of active) m.set(b.id, birdStatus(b, todayLogs.filter((l) => l.bird_id === b.id), today).state);
    return m;
  }, [active, todayLogs, today]);

  const toFeed = active.filter((b) => needsFeeding(states.get(b.id)!)).length;
  const query = search.trim().toLowerCase();
  // A search looks through every bird, fed or not, so you can always find one.
  const shown = query
    ? active.filter((b) => {
        const aviary = aviaries.find((a) => a.id === b.aviary_id);
        return [b.name, b.species ?? '', aviary ? aviaryLabel(aviary) : ''].some((t) => t.toLowerCase().includes(query));
      })
    : filter === 'todo'
      ? active.filter((b) => needsFeeding(states.get(b.id)!))
      : active;
  // Walking order, with a heading each time the round moves into a new section
  const groups = sectionRuns(routeSort(shown, aviaries), aviaries);

  if (loading) return <p className="empty">Loading…</p>;
  if (active.length === 0)
    return (
      <p className="empty">
        No birds yet. <Link to="/admin/import">Import the bird list</Link> to get started.
      </p>
    );

  const concerns = openConcerns(careLogs);
  const toCheck = active.filter((b) => !birdCheckToday(b.id, careLogs, today)).length;
  const frost = !!forecast && forecast.low <= careSettings.frost_below;
  const dosesLeft = dosesToday(medications, doses, today).reduce((n, x) => n + x.left, 0);
  const photosDue = healthIssues.filter((i) => photoStatus(i, healthEntries, today).due).length;

  return (
    <div className="today">
      <header className="today-head">
        <div className="today-title">
          <h1>Today</h1>
          <span className="muted">{formatDay(today)}</span>
        </div>
        <div className="summary-strip">
          <button className={`sum-chip ${toFeed ? 'danger' : 'ok'}`} onClick={() => setFilter(filter === 'todo' ? 'all' : 'todo')} aria-pressed={filter === 'todo'}>
            {toFeed ? `${toFeed} to feed` : '✓ All fed'}
          </button>
          {toCheck > 0 && <span className="sum-chip plain">{toCheck} to check</span>}
          {concerns.length > 0 && (
            <button className={`sum-chip warn`} onClick={() => setPanel(panel === 'concerns' ? null : 'concerns')} aria-expanded={panel === 'concerns'}>
              ⚠ {concerns.length} concern{concerns.length === 1 ? '' : 's'}
            </button>
          )}
          <button className="sum-chip plain" onClick={() => setPanel(panel === 'requests' ? null : 'requests')} aria-expanded={panel === 'requests'}>
            {requests.length} request{requests.length === 1 ? '' : 's'}
          </button>
          {dosesLeft > 0 && (
            <button className="sum-chip meds" onClick={() => setPanel(panel === 'meds' ? null : 'meds')} aria-expanded={panel === 'meds'}>
              💊 {dosesLeft} dose{dosesLeft === 1 ? '' : 's'} due
            </button>
          )}
          {photosDue > 0 && (
            <Link className="sum-chip meds" to="/health">
              📷 {photosDue} photo{photosDue === 1 ? '' : 's'} due
            </Link>
          )}
          {cleaning.alertCount > 0 && (
            <Link className="sum-chip clean-alert" to="/clean" title={cleaning.alerts.join(', ')}>
              🧽 {cleaning.alerts[0]}
              {cleaning.alerts.length > 1 ? ` +${cleaning.alerts.length - 1}` : ''}
            </Link>
          )}
          {frost && (
            <button className="sum-chip frost" onClick={() => setPanel(panel === 'frost' ? null : 'frost')} aria-expanded={panel === 'frost'}>
              ❄ Frost
            </button>
          )}
        </div>
      </header>

      {panel === 'frost' && <FrostBanner />}
      {panel === 'meds' && <DosesDue />}
      {panel === 'concerns' && <ConcernList />}
      {panel === 'requests' && (
        <section className="panel">
          <div className="section-head">
            <h2>Special requests</h2>
            <button className="btn btn-outline" onClick={() => setAddingRequest(true)}>
              + Add
            </button>
          </div>
          {requests.length === 0 ? <p className="muted">None today.</p> : <RequestList requests={requests} />}
        </section>
      )}

      <div className="today-actions">
        {toFeed > 0 && (
          <Link to="/round" className="btn btn-primary btn-lg">
            🧭 Feeding round
          </Link>
        )}
        <Link to="/session" className="btn btn-outline btn-lg">
          ✈ Log a session
        </Link>
      </div>

      <div className="sticky-filter">
        <div className="search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bird, species or aviary"
            aria-label="Search birds"
            autoComplete="off"
            enterKeyHint="search"
          />
          {search && (
            <button className="btn btn-ghost" onClick={() => setSearch('')} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>
        {!query && (
          <div className="filter-row">
            <div className="segmented" role="radiogroup" aria-label="Show">
              <button role="radio" aria-checked={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
                All
              </button>
              <button role="radio" aria-checked={filter === 'todo'} className={filter === 'todo' ? 'on' : ''} onClick={() => setFilter('todo')}>
                To feed ({toFeed})
              </button>
            </div>
            <button className="btn btn-outline view-toggle" onClick={() => setView(view === 'rows' ? 'cards' : 'rows')} aria-label={view === 'rows' ? 'Show full cards' : 'Show compact rows'}>
              {view === 'rows' ? '▤ Cards' : '☰ Rows'}
            </button>
          </div>
        )}
      </div>
      {query && shown.length === 0 && <p className="empty">No bird matches "{search.trim()}".</p>}

      {groups.map(({ key, title, birds }) => (
        <section key={key} className={`aviary-group${view === 'rows' ? ' rows' : ''}`}>
          <h2 className="aviary-title">{title === 'No aviary' ? title : <Link to={sectionPath(title)}>{title}</Link>}</h2>
          {birds.map((b) => (view === 'rows' ? <BirdRow key={b.id} bird={b} /> : <BirdCard key={b.id} bird={b} />))}
        </section>
      ))}
      {!query && filter === 'todo' && toFeed === 0 && <p className="empty">Nothing left to feed.</p>}

      {addingRequest && <RequestSheet onClose={() => setAddingRequest(false)} />}
    </div>
  );
}
