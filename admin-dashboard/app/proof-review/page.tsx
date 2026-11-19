'use client';

import { useEffect, useState } from 'react';
import { api } from '../../src/services/api';

type ProofRow = {
  RouteStopId: number;
  RouteName?: string | null;
  RouteDate?: string | null;
  StopOrder?: number;
  StopLabel?: string | null;
  TargetType?: string;
  NPI?: string | null;
  StopAddress?: string | null;
  AssignedFlyerName?: string | null;
  StopStatus?: string;
  CampaignName?: string | null;
  DistributorName?: string | null;
  Specialty?: string | null;
  CheckedInAt?: string | null;
  CheckInLatitude?: number | null;
  CheckInLongitude?: number | null;
  CheckInDistanceMiles?: number | null;
  LocationVerified?: boolean | number | null;
  VerificationNote?: string | null;
  HasProof?: boolean | number;
  ProofUploadedAt?: string | null;
  Notes?: string | null;
  SkippedReason?: string | null;
};

export default function ProofReviewPage() {
  const [rows, setRows] = useState<ProofRow[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [routeDate, setRouteDate] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [loadingPhotoId, setLoadingPhotoId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/reports/proof-review', {
        params: {
          campaignId: campaignId || undefined,
          routeDate: routeDate || undefined,
          status: status || undefined,
        },
      });
      setRows(res.data.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function viewProof(routeStopId: number) {
    setPhotoError('');
    setLoadingPhotoId(routeStopId);
    try {
      const res = await api.get(`/reports/route-stops/${routeStopId}/proof`, { responseType: 'blob' });
      const headerContentType = res.headers['content-type'];
      const contentType = typeof headerContentType === 'string' ? headerContentType : 'image/jpeg';
      const blob = new Blob([res.data], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) setPhotoError('Popup blocked. Allow popups to view proof photos.');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      setPhotoError('Could not open proof photo.');
    } finally {
      setLoadingPhotoId(null);
    }
  }

  return (
    <div>
      <h1>Proof Review</h1>
      <p>Review route stop check-ins and uploaded proof photos.</p>

      <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
        <input placeholder="Campaign ID" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All stop statuses</option>
          <option value="pending">Pending</option>
          <option value="arrived">Arrived</option>
          <option value="completed">Completed</option>
          <option value="skipped">Skipped</option>
          <option value="failed">Failed</option>
        </select>
        <button type="button" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {photoError ? <p style={{ color: '#b91c1c' }}>{photoError}</p> : null}
      {loading ? <p>Loading...</p> : null}

      <table>
        <thead>
          <tr>
            <th>Route / Stop</th>
            <th>Target</th>
            <th>Flyer / Campaign</th>
            <th>Check-in</th>
            <th>Proof</th>
            <th>Status / Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.RouteStopId}>
              <td>
                {row.RouteName}<br />
                <small>{String(row.RouteDate || '').slice(0, 10)} · #{row.StopOrder}</small><br />
                <small>{row.DistributorName}</small>
              </td>
              <td>
                <strong>{row.StopLabel || '—'}</strong><br />
                <small>{row.TargetType}{row.NPI ? ` · NPI ${row.NPI}` : ''}</small><br />
                <small>{row.Specialty || ''}</small><br />
                <small>{row.StopAddress || ''}</small>
              </td>
              <td>
                {row.AssignedFlyerName || '—'}<br />
                <small>{row.CampaignName || ''}</small>
              </td>
              <td>
                {row.CheckedInAt ? String(row.CheckedInAt).slice(0, 16).replace('T', ' ') : '—'}<br />
                <small>
                  {row.CheckInLatitude != null ? `${row.CheckInLatitude}, ${row.CheckInLongitude}` : 'No GPS'}
                  {row.CheckInDistanceMiles != null ? ` · ${row.CheckInDistanceMiles} mi` : ''}
                </small><br />
                <small>{row.LocationVerified ? 'Verified' : row.CheckedInAt ? 'Unverified' : ''}</small>
                {row.VerificationNote ? <><br /><small>{row.VerificationNote}</small></> : null}
              </td>
              <td>
                {row.HasProof ? (
                  <>
                    <button type="button" onClick={() => viewProof(row.RouteStopId)} disabled={loadingPhotoId === row.RouteStopId}>
                      {loadingPhotoId === row.RouteStopId ? 'Opening...' : 'View photo'}
                    </button>
                    <br />
                    <small>{row.ProofUploadedAt ? String(row.ProofUploadedAt).slice(0, 16).replace('T', ' ') : ''}</small>
                  </>
                ) : '—'}
              </td>
              <td>
                {row.StopStatus}<br />
                <small>{row.Notes || row.SkippedReason || ''}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && !rows.length ? <p>No route stops match filters.</p> : null}
    </div>
  );
}
