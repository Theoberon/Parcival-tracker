import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Used when the server decides an admin session is over (12 hours). Cookies can be cleared here.
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const expired = request.nextUrl.searchParams.get('expired') ? '?expired=1' : '';
  return NextResponse.redirect(new URL('/admin/login' + expired, request.url));
}
