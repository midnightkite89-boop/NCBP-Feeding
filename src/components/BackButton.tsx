import { useNavigate } from 'react-router-dom';

/** "← Back" to wherever this page was opened from (e.g. the feeding round), or Today if opened directly */
export function BackButton() {
  const navigate = useNavigate();
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <button type="button" className="btn btn-ghost back-btn" onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
      <span aria-hidden="true">←</span> {canGoBack ? 'Back' : 'Today'}
    </button>
  );
}

