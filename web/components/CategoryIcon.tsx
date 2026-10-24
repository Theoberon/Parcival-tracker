type CategoryIconKind = 'profile' | 'list' | 'envelope' | 'handshake';

function iconKind(name: string): CategoryIconKind {
  const normalized = name.toLowerCase();
  if (normalized.includes('account')) return 'profile';
  if (normalized.includes('gig')) return 'list';
  if (normalized.includes('converted') || normalized.includes('order')) return 'handshake';
  return 'envelope';
}

export default function CategoryIcon({ name }: { name: string }) {
  const kind = iconKind(name);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-auto h-5 w-5"
    >
      {kind === 'profile' ? (
        <>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.5 20c.6-3.5 3-5.25 6.5-5.25s5.9 1.75 6.5 5.25" />
        </>
      ) : null}
      {kind === 'list' ? (
        <>
          <path d="M9 6h10M9 12h10M9 18h10" />
          <circle cx="5" cy="6" r=".75" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r=".75" fill="currentColor" stroke="none" />
          <circle cx="5" cy="18" r=".75" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {kind === 'envelope' ? <path d="M3.5 6.5h17v11h-17zM4 7l8 6 8-6" /> : null}
      {kind === 'handshake' ? (
        <path d="m3 9 3-3 4 1 2-1 6 1 3 3-3 5-2-1-2 2-2-1-2 1-5-4-2-3Zm3-3 4 4 2-1 3 2m-7 3 2 2m1-3 2 2m1-4 2 2" />
      ) : null}
    </svg>
  );
}
