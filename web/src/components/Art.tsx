import { useState } from 'react';

// hq720 is sharp and has no letterbox bars; older videos lack it, so fall back to mqdefault.
// `hi` only for big artwork; small cards use the light mqdefault so shelves load fast.
export function Art({ id, className, hi }: { id: string; className?: string; hi?: boolean }) {
  const [src, setSrc] = useState(`https://i.ytimg.com/vi/${id}/${hi ? 'hq720' : 'mqdefault'}.jpg`);
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={`${className ?? ''} img-fade${loaded ? ' in' : ''}`}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setSrc(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`)}
    />
  );
}
