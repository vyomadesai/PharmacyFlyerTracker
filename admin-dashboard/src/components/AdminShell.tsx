'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { clearStoredAuth, getStoredToken, getStoredUser, isAdminOrManager } from '../utils/auth';

const PUBLIC_PATHS = new Set(['/', '/access-denied']);

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (PUBLIC_PATHS.has(pathname)) {
      setReady(true);
      return;
    }

    const token = getStoredToken();
    const user = getStoredUser();

    if (!token || !user) {
      router.replace('/');
      return;
    }

    if (!isAdminOrManager(user.role)) {
      router.replace('/access-denied');
      return;
    }

    api.get('/auth/me').catch(() => {
      clearStoredAuth();
      router.replace('/');
    }).finally(() => setReady(true));
  }, [pathname, router]);

  if (PUBLIC_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  if (!ready) {
    return <main className="main"><p>Checking access...</p></main>;
  }

  return (
    <>
      <nav className="nav">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/campaigns">Campaigns</Link>
        <Link href="/approval-queue">Approval Queue</Link>
        <Link href="/markets">Markets</Link>
        <Link href="/pharmacies">Pharmacies</Link>
        <Link href="/distributors">Distributors</Link>
        <Link href="/routes">Routes</Link>
        <Link href="/deliveries">Deliveries</Link>
        <Link href="/map">Map</Link>
        <Link href="/proof-review">Proof Review</Link>
        <Link href="/reports">Reports</Link>
        <Link href="/npi-registery">NPI Registery</Link>
        <button
          type="button"
          className="nav-logout"
          onClick={() => {
            clearStoredAuth();
            router.replace('/');
          }}
        >
          Logout
        </button>
      </nav>
      <main className="main">{children}</main>
    </>
  );
}
