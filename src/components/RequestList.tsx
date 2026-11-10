import { useStore } from '../store';
import { formatDay } from '../time';
import type { SpecialRequest } from '../types';

export function RequestList({ requests, showBird = true }: { requests: SpecialRequest[]; showBird?: boolean }) {
  const { birds, staffName, clearRequest, today } = useStore();
  if (requests.length === 0) return null;

  function clear(r: SpecialRequest) {
    if (window.confirm(`Clear this request?\n\n"${r.instruction}"`)) clearRequest(r.id);
  }

  return (
    <ul className="requests">
      {requests.map((r) => {
        const bird = birds.find((b) => b.id === r.bird_id);
        return (
          <li key={r.id} className="request">
            <div className="request-body">
              {showBird && <strong>{bird ? bird.name : 'Everyone'}: </strong>}
              {r.instruction}
              <div className="meta">
                {staffName(r.created_by)} ·{' '}
                {r.expires_on == null ? 'until cleared' : r.expires_on === today ? 'today only' : `until ${formatDay(r.expires_on)}`}
                {r.pending && ' · not sent yet'}
              </div>
            </div>
            <button className="btn btn-outline" onClick={() => clear(r)}>
              Clear
            </button>
          </li>
        );
      })}
    </ul>
  );
}
