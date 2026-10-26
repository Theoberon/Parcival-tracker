'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import LogoutButton from '../LogoutButton';
import OrganizationSwitcher from './OrganizationSwitcher';

const LINKS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/admin', label: 'Queue', exact: true },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/log', label: 'Log' },
  { href: '/admin/board', label: 'Board' },
];
const OWNER_LINKS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/admin/contest', label: 'Contest' },
  { href: '/admin/admins', label: 'Admins' },
];

export default function AdminNav({ role, email, platformOwner, organizationId }: {
  role: 'owner' | 'admin';
  email: string;
  platformOwner: boolean;
  organizationId: string | null;
}) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => setCopyStatus('idle'), [organizationId]);
  const links = role === 'owner'
    ? [...LINKS.slice(0, 3), ...OWNER_LINKS, ...(platformOwner ? [{ href: '/admin/organizations', label: 'Organisations' }] : []), ...LINKS.slice(3)]
    : LINKS;

  return (
    <header className="glass-nav sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div
          className="relative h-full"
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => setMenuOpen(false)}
          onFocus={() => setMenuOpen(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuOpen(false);
          }}
        >
          <button
            type="button"
            className="flex h-full w-12 items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-white/5 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="admin-side-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {menuOpen
                ? <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>
                : <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>}
            </svg>
          </button>
          <aside
            id="admin-side-menu"
            aria-label="Admin navigation"
            aria-hidden={!menuOpen}
            className={`glass-nav absolute left-0 top-full flex max-h-[calc(100dvh-3.5rem)] w-72 flex-col gap-4 overflow-y-auto rounded-br-2xl border border-l-0 border-t-0 p-4 shadow-2xl transition duration-200 ${menuOpen ? 'visible translate-x-0 opacity-100' : 'invisible -translate-x-3 opacity-0'}`}
          >
            <nav className="flex flex-col gap-1">
              {links.map((link) => {
                const active = link.exact ? path === link.href : path.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    tabIndex={menuOpen ? undefined : -1}
                    onClick={() => setMenuOpen(false)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-sky-300/12 text-sky-100 ring-1 ring-inset ring-sky-200/15' : 'text-slate-600 hover:bg-white/5 hover:text-slate-900'}`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            {platformOwner ? <OrganizationSwitcher selectedId={organizationId} /> : null}
            <div className="flex flex-col gap-3 border-t border-white/5 pt-3">
              <span className="break-all text-xs text-slate-500">{email} · {role}</span>
              <LogoutButton to="/admin/login" />
            </div>
          </aside>
        </div>
        {role === 'owner' && organizationId ? (
          <div>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
              aria-label="Copy organisation ID"
              title={copyStatus === 'copied' ? 'Organisation ID copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy organisation ID'}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(organizationId);
                  setCopyStatus('copied');
                } catch {
                  setCopyStatus('failed');
                }
              }}
            >
              {copyStatus === 'copied'
                ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
                : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>}
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {copyStatus === 'copied' ? 'Organisation ID copied.' : copyStatus === 'failed' ? 'Could not copy organisation ID.' : ''}
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
