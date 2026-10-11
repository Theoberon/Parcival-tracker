'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LogoutButton from '../LogoutButton';

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

export default function AdminNav({ role, email }: { role: 'owner' | 'admin'; email: string }) {
  const path = usePathname();
  const links = role === 'owner' ? [...LINKS.slice(0, 3), ...OWNER_LINKS, ...LINKS.slice(3)] : LINKS;
  return (
    <header className="glass-nav sticky top-0 z-40 border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <nav className="flex flex-1 flex-wrap gap-1">
          {links.map((l) => {
            const active = l.exact ? path === l.href : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-sky-300/12 text-sky-100 ring-1 ring-inset ring-sky-200/15' : 'text-slate-600 hover:bg-white/5 hover:text-slate-900'}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <span className="hidden text-xs text-slate-500 sm:inline">{email} · {role}</span>
        <LogoutButton to="/admin/login" />
      </div>
    </header>
  );
}
