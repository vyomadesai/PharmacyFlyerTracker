'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../src/services/api';

type Rep = {
  userId: number;
  fullName?: string | null;
  userCode?: string | null;
  email?: string | null;
};

type RoutePlanDetail = {
  routePlanId: number;
  routeName: string;
  campaignName?: string | null;
  status?: string;
  startLabel?: string | null;
  radiusMiles?: number | null;
  planDate?: string | null;
  assignedUserId?: number | null;
  assignedUserName?: string | null;
  stops: Array<{
    routePlanStopId: number;
    stopOrder: number;
    stopLabel: string;
    addressStreet?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    addressZip?: string | null;
    distanceMiles?: number | null;
    status?: string | null;
    doctorCount?: number;
    doctors: Array<{
      doctorId: number;
      doctorName: string;
      matchedSpecialityCode?: string | null;
      matchedLevel?: string | null;
      status?: string | null;
    }>;
    flyers: Array<{ campaignName?: string | null; flyerTitle?: string | null }>;
  }>;
};

const LEVEL_LABELS: Record<string, string> = {
  '1': 'Primary',
  '2': 'Secondary',
  '3': 'Tertiary',
};

export default function RoutePlanDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const routePlanId = Number(params.id);

  const [plan, setPlan] = useState<RoutePlanDetail | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [assignedUserId, setAssignedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!Number.isFinite(routePlanId)) {
      setError('Invalid route id.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [planRes, repsRes] = await Promise.all([
        api.get<RoutePlanDetail>(`/route-planner/plans/${routePlanId}`),
        api.get<Rep[]>('/route-planner/reps'),
      ]);
      setPlan(planRes.data);
      setReps(repsRes.data);
      if (planRes.data.assignedUserId) {
        setAssignedUserId(String(planRes.data.assignedUserId));
      }
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load route plan.');
      }
    } finally {
      setLoading(false);
    }
  }, [routePlanId]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.push('/');
      return;
    }
    load();
  }, [router, load]);

  async function handleAssign() {
    if (!assignedUserId) {
      setError('Select a rep to assign.');
      return;
    }
    setAssigning(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post(`/route-planner/plans/${routePlanId}/assign`, {
        assignedUserId: Number(assignedUserId),
      });
      setPlan(res.data);
      setSuccess('Route assigned to rep.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not assign route.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div>
      <p><Link href="/routes-available" style={{ color: '#2563eb' }}>← Back to Routes Available</Link></p>
      {loading ? <p>Loading route…</p> : null}
      {error ? <div className="card workflow-error">{error}</div> : null}
      {success ? (
        <div className="card" style={{ borderLeft: '4px solid #16a34a', background: '#f0fdf4', color: '#166534' }}>
          {success}
        </div>
      ) : null}

      {plan ? (
        <>
          <h1>{plan.routeName}</h1>
          <div className="card" style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
            <div><strong>Campaign:</strong> {plan.campaignName || '—'}</div>
            <div><strong>Date:</strong> {plan.planDate ? String(plan.planDate).slice(0, 10) : '—'}</div>
            <div><strong>Status:</strong> {plan.status || '—'}</div>
            <div><strong>Start:</strong> {plan.startLabel || '—'}{plan.radiusMiles != null ? ` · ${plan.radiusMiles} mi radius` : ''}</div>
            <div><strong>Assigned rep:</strong> {plan.assignedUserName || 'Unassigned'}</div>
          </div>

          <div className="card" style={{ display: 'grid', gap: 10, maxWidth: 720, marginTop: 16 }}>
            <strong>Assign to field rep</strong>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            >
              <option value="">— Select rep —</option>
              {reps.map((rep) => (
                <option key={rep.userId} value={String(rep.userId)}>
                  {rep.fullName || rep.userCode || rep.email || `User ${rep.userId}`}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleAssign} disabled={assigning || !assignedUserId}>
              {assigning ? 'Assigning…' : 'Assign route'}
            </button>
          </div>

          <h2>Stops ({plan.stops.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Location</th>
                  <th>Distance</th>
                  <th>Status</th>
                  <th>Doctors</th>
                  <th>Flyers to drop</th>
                </tr>
              </thead>
              <tbody>
                {plan.stops.map((stop) => (
                  <tr key={stop.routePlanStopId}>
                    <td>{stop.stopOrder}</td>
                    <td>
                      <strong>{stop.stopLabel}</strong>
                      <br />
                      <small>
                        {[stop.addressStreet, [stop.addressCity, stop.addressState, stop.addressZip].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                      </small>
                      {stop.doctors.length ? (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {stop.doctors.map((d) => (
                            <li key={d.doctorId}>
                              {d.doctorName}
                              {d.matchedSpecialityCode ? ` — ${d.matchedSpecialityCode}` : ''}
                              {d.matchedLevel ? ` (${LEVEL_LABELS[d.matchedLevel] || d.matchedLevel})` : ''}
                              {d.status === 'completed' ? ' ✓' : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td>{stop.distanceMiles != null ? `${Number(stop.distanceMiles).toFixed(1)} mi` : '—'}</td>
                    <td>{stop.status || 'pending'}</td>
                    <td>{stop.doctorCount ?? stop.doctors.length}</td>
                    <td>{stop.flyers.map((f) => f.flyerTitle || f.campaignName).filter(Boolean).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
