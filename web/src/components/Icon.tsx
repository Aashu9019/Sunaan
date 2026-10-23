const paths: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  library: 'M4 4v16M9 4v16M14 4l5 16',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 20a7 7 0 0 0-4-6.3',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  next: 'M5 5v14l10-7L5 5Zm13 0v14',
  prev: 'M19 5v14L9 12l10-7ZM6 5v14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  down: 'M12 4v12m0 0-5-5m5 5 5-5M5 20h14',
  check: 'M5 12.5 10 17l9-10',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3m4-4 3-3h4m-3-3 3 3-3 3m0 4 3 3-3 3',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  queue: 'M4 6h12M4 12h12M4 18h8m6-3v6l4-3-4-3Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4',
  share:'M12 3v13m0-13-4 4m4-4 4 4M5 13v7h14v-7',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const filled = name === 'play' || name === 'pause' || name === 'next' || name === 'prev';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}
