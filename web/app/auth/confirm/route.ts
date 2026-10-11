// Landing point for admin invite / password-reset emails (token-hash flow).
import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // only ever redirect inside this site, and only to the set-password page
  const next = searchParams.get('next') === '/admin/set-password' ? '/admin/set-password' : '/admin/login';

  if (tokenHash && (type === 'invite' || type === 'recovery')) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL('/admin/login?error=invalid_link', request.url));
}
