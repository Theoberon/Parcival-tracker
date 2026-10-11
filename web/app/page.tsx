import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');   // logged-out visitors are sent on to /login by the proxy
}
