import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BirdPhoto } from '../components/BirdPhoto';
import { useStore } from '../store';

export function BirdsAdmin() {
  const { birds, aviaries } = useStore();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const list = birds.filter(
    (b) => (showArchived || b.status === 'active') && `${b.name} ${b.species ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div>
      <h1 className="page-title">Birds</h1>
      <Link to="/admin/birds/new" className="btn btn-primary btn-lg">
        + Add bird
      </Link>
      <label className="field">
        <span>Search</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or species" />
      </label>
      <label className="check">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        <span>Show archived</span>
      </label>
      <ul className="admin-list">
        {list.map((b) => (
          <li key={b.id}>
            <Link to={`/admin/birds/${b.id}`} className={b.status === 'archived' ? 'archived' : ''}>
              <BirdPhoto bird={b} size={44} />
              <span>
                <strong>{b.name}</strong> {b.status === 'archived' && '(archived)'}
                <br />
                <small>
                  {b.species ?? '—'} · {aviaries.find((a) => a.id === b.aviary_id)?.name ?? 'no aviary'}
                </small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
