import { Link } from 'react-router-dom';
import { photoStatus } from '../health';
import { useStore } from '../store';
import type { Bird } from '../types';

/** Open health issues for a bird, with "photo due" when a reminder is set */
export function HealthAlerts({ bird }: { bird: Bird }) {
  const { healthIssues, healthEntries, today } = useStore();
  const issues = healthIssues.filter((i) => i.bird_id === bird.id);
  if (issues.length === 0) return null;
  return (
    <div className="health-alerts">
      {issues.map((i) => {
        const due = photoStatus(i, healthEntries, today).due;
        return (
          <Link key={i.id} to={`/health/issue/${i.id}`} className={`health-alert${due ? ' photo-due-line' : ''}`}>
            🩺 {i.title}
            {due && <strong> · 📷 photo due</strong>}
          </Link>
        );
      })}
    </div>
  );
}
