import { useState } from 'react';

// Prefers square album art (`src`, from YouTube Music). Otherwise the video thumbnail:
// hq720 for big artwork (`hi`), light mqdefault for small cards.
export function Art({ id, src, className, hi }: { id: string; src?: string; className?: string; hi?: boolean }) {
  const fallback = `https://i.ytimg.com/vi/${id}/${hi ? 'hq720' : 'mqdefault'}.jpg`;
  const [url, setUrl] = useState(src || fallback);
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={`${className ?? ''} img-fade${loaded ? ' in' : ''}`}
      src={url}
      alt=""
      loading="lazy"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setUrl(url === fallback ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : fallback)}
    />
  );
}
