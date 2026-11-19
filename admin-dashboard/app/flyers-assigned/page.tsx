'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';

type SessionCampaign = {
  campaignId: number;
  campaignName: string;
  flyerTitle?: string | null;
};

type CheckInSession = {
  checkInId: number;
  userId: number;
  fullName: string | null;
  routePlanId: number | null;
  routeName: string | null;
  planDate: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  checkInLat: number | null;
  checkInLng: number | null;
  radiusMiles: number | null;
  stopCount: number | null;
  campaigns: SessionCampaign[];
};

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatGps(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function campaignLabels(campaigns: SessionCampaign[]) {
  if (!campaigns.length) return '—';
  return campaigns
    .map((c) => c.flyerTitle || c.campaignName || `Campaign ${c.campaignId}`)
    .join('; ');
}

export default function FlyersAssignedPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CheckInSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ sessions: CheckInSession[] }>('/route-planner/checkins', {
        params: { limit: 200 },
      });
      setSessions(Array.isArray(res.data?.sessions) ? res.data.sessions : []);
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load check-in sessions.');
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

  const activeCount = sessions.filter((s) => !s.checkOutAt).length;

  return (
    <div>
      <PageHeader
        eyebrow="Field activity"
        title="Check-ins"
        subtitle={
          <>
            Smart Route check-in sessions from the mobile app — which rep checked in, when and where, how many
            nearby stops were built for the day, and which flyers were on that route. Coverage and visit
            frequency are set in <Link href="/route-planner">Route Planner</Link>.
          </>
        }
        actions={
          <>
            <span className="badge badge-success badge-dot">{activeCount} active now</span>
            <span className="badge badge-primary">{sessions.length} sessions</span>
            <button type="button" className="btn-ghost btn-sm" onClick={load} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card table-card">
        {loading ? (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="loading-row"><span className="spinner" /> Loading check-in sessions…</span>
          </div>
        ) : null}

        {!loading && sessions.length === 0 && !error ? (
          <div className="empty-state">
            <strong>No check-in sessions yet</strong>
            <p>Sessions appear here as soon as a rep taps <b>Check in</b> on the Smart Route screen in the mobile app.</p>
          </div>
        ) : null}

        {!loading && sessions.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Status</th>
                  <th>Checked in</th>
                  <th>Checked out</th>
                  <th>Check-in GPS</th>
                  <th>Radius</th>
                  <th>Stops</th>
                  <th>Flyers on route</th>
                  <th>Route plan</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.checkInId}>
                    <td className="cell-primary">{s.fullName || `User ${s.userId}`}</td>
                    <td>
                      {s.checkOutAt ? (
                        <span className="badge badge-muted">Checked out</span>
                      ) : (
                        <span className="badge badge-success badge-dot">Active</span>
                      )}
                    </td>
                    <td className="cell-nowrap">{formatWhen(s.checkInAt)}</td>
                    <td className="cell-nowrap">{s.checkOutAt ? formatWhen(s.checkOutAt) : '—'}</td>
                    <td className="cell-mono cell-nowrap">{formatGps(s.checkInLat, s.checkInLng)}</td>
                    <td className="cell-nowrap">{s.radiusMiles != null ? `${s.radiusMiles} mi` : '—'}</td>
                    <td>
                      {s.stopCount != null ? <span className="rp-doc-count">{s.stopCount}</span> : '—'}
                    </td>
                    <td style={{ maxWidth: 360 }}>
                      {s.campaigns.length ? (
                        <div className="chip-row">
                          {s.campaigns.map((c) => (
                            <span key={c.campaignId} className="badge badge-violet" title={`Campaign ${c.campaignId}`}>
                              {c.flyerTitle || c.campaignName || `Campaign ${c.campaignId}`}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">{campaignLabels(s.campaigns)}</span>
                      )}
                    </td>
                    <td className="cell-nowrap">
                      {s.routePlanId ? (
                        <>
                          <div className="cell-primary">#{s.routePlanId}</div>
                          {s.routeName ? <div className="cell-secondary">{s.routeName}</div> : null}
                          {s.planDate ? <div className="cell-secondary">{String(s.planDate).slice(0, 10)}</div> : null}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
