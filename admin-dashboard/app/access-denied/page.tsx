'use client';

import Link from 'next/link';
import { clearStoredAuth, getStoredUser } from '../../src/utils/auth';

export default function AccessDeniedPage() {
  const user = getStoredUser();

  return (
    <div className="card" style={{ maxWidth: 520, margin: '80px auto' }}>
      <h1>Access Denied</h1>
      <p>
        The admin dashboard is only available to admin and manager accounts.
        {user?.role === 'distributor' ? ' Your account is a field distributor — please use the mobile app.' : ''}
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <Link href="/">Back to login</Link>
        <button type="button" onClick={() => { clearStoredAuth(); window.location.href = '/'; }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
