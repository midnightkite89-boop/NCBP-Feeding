import { useStore } from '../store';
import type { Bird } from '../types';

export function BirdPhoto({ bird, size = 64 }: { bird: Bird; size?: number }) {
  const { photoUrls } = useStore();
  const url = bird.photo_path ? photoUrls[bird.photo_path] : undefined;
  return (
    <div className="bird-photo" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" loading="lazy" /> : <span aria-hidden="true">{bird.name.charAt(0)}</span>}
    </div>
  );
}
