'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

const KEY = 'admin:lastActive';
const LIMIT_MS = 12 * 60 * 60 * 1000;

/** Signs the admin out after 12 hours without activity (the server also caps the session age). */
export default function IdleLogout() {
  const router = useRouter();
  useEffect(() => {
    const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
    const write = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } };
    if (!read()) write();

    let lastWrite = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite > 30_000) { lastWrite = now; write(); }
    };
    const check = async () => {
      const last = read();
      if (last && Date.now() - last > LIMIT_MS) {
        await supabaseBrowser().auth.signOut();
        router.replace('/admin/login?expired=1');
        router.refresh();
      }
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [router]);
  return null;
}
