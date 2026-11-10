import { Link } from 'react-router-dom';
import { useStore } from '../store';

export function AdminHome() {
  const { birds, aviaries, profiles } = useStore();
  const active = birds.filter((b) => b.status === 'active').length;
  const tiles = [
    { to: '/admin/birds', title: 'Birds', sub: `${active} active` },
    { to: '/admin/route', title: 'Feeding route', sub: 'Order birds appear in' },
    { to: '/admin/care', title: 'Cleaning & winter', sub: 'Timings, products, winter dates' },
    { to: '/admin/aviaries', title: 'Aviaries', sub: `${aviaries.filter((a) => !a.archived).length} in use` },
    { to: '/admin/import', title: 'Import CSV', sub: 'Add or update birds in bulk' },
    { to: '/admin/qr', title: 'QR labels', sub: 'Print aviary codes' },
    { to: '/admin/staff', title: 'Staff', sub: `${profiles.length} logins` },
  ];
  return (
    <div>
      <h1 className="page-title">Admin</h1>
      <div className="tiles">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <strong>{t.title}</strong>
            <span>{t.sub}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
