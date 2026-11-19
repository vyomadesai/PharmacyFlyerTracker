'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../src/services/api';

type SavedRoutePlan = {
  routePlanId: number;
  routeName: string;
  planDate?: string | null;
  status?: string;
  locationCount?: number;
  doctorCount?: number;
  flyerDropCount?: number;
  assignedUserName?: string | null;
  campaignName?: string | null;
};

type SavedRoutesResponse = {
  routes: SavedRoutePlan[];
};

export default function RoutesAvailablePage() {
  const router = useRouter();
  const [routes, setRoutes] = useState<SavedRoutePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<SavedRoutesResponse>('/route-planner/plans');
      setRoutes(Array.isArray(res.data?.routes) ? res.data.routes : []);
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load saved routes.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.push('/');
      return;
    }
    load();
  }, [router, load]);

  return (
    <div>
      <h1>Routes Available</h1>
      <p style={{ color: '#64748b', marginTop: 0 }}>
        Saved route plans from{' '}
        <Link href="/route-planner" style={{ color: '#2563eb' }}>Route Planner</Link>.
      </p>

      {error ? <div className="card workflow-error">{error}</div> : null}
      {loading ? <p>Loading saved routes…</p> : null}

      {!loading && routes.length === 0 && !error ? (
        <div className="card" style={{ color: '#64748b', textAlign: 'center', padding: '32px 18px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 16 }}>No saved routes yet.</p>
          <p style={{ margin: 0 }}>
            <Link href="/route-planner" style={{ color: '#2563eb' }}>Preview and save a route</Link>
          </p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Route name</th>
              <th>Campaign</th>
              <th>Date</th>
              <th>Stops</th>
              <th>Doctors</th>
              <th>Flyer drops</th>
              <th>Status</th>
              <th>Assigned rep</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route.routePlanId}>
                <td>
                  <Link href={`/routes-available/${route.routePlanId}`} style={{ color: '#2563eb', fontWeight: 700 }}>
                    {route.routeName}
                  </Link>
                </td>
                <td>{route.campaignName || '—'}</td>
                <td>{route.planDate ? String(route.planDate).slice(0, 10) : '—'}</td>
                <td>{route.locationCount ?? '—'}</td>
                <td>{route.doctorCount ?? '—'}</td>
                <td>{route.flyerDropCount ?? '—'}</td>
                <td>{route.status || '—'}</td>
                <td>{route.assignedUserName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
