'use client';

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '../../src/components/PageHeader';
import Pagination from '../../src/components/Pagination';
import { api } from '../../src/services/api';
import { DEFAULT_PAGE_SIZE, type PaginatedResponse } from '../../src/types/pagination';

function responseBadgeClass(status?: string) {
  const s = String(status || '').toLowerCase();
  if (!s) return 'badge-muted';
  if (s.includes('accepted') || s.includes('left with')) return 'badge-success';
  if (s.includes('interested') && !s.includes('not')) return 'badge-primary';
  if (s.includes('follow') || s.includes('not available') || s.includes('closed')) return 'badge-warning';
  if (s.includes('declined') || s.includes('not interested')) return 'badge-danger';
  return 'badge-muted';
}

type DeliveryRow = {
  DeliveryId: number;
  SubmittedAt: string;
  User_FirstName?: string;
  User_LastName?: string;
  DoctorName?: string;
  ClinicName?: string;
  DoctorAddressCity?: string;
  DoctorAddressState?: string;
  ResponseStatus?: string;
  CompletionStatus?: string;
  AssignmentId?: number | null;
  RouteId?: number | null;
  Latitude?: number | string;
  Longitude?: number | string;
  HasPhoto?: boolean | number;
};

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingPhotoId, setLoadingPhotoId] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState('');

  const loadDeliveries = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<DeliveryRow>>('/deliveries', {
        params: { page: nextPage, pageSize: DEFAULT_PAGE_SIZE },
      });
      setDeliveries(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeliveries(page);
  }, [loadDeliveries, page]);

  async function viewPhoto(deliveryId: number) {
    setPhotoError('');
    setLoadingPhotoId(deliveryId);

    try {
      const res = await api.get(`/deliveries/${deliveryId}/photo`, {
        responseType: 'blob',
      });
      const headerContentType = res.headers['content-type'];
      const contentType =
        typeof headerContentType === 'string' ? headerContentType : 'image/jpeg';

      const blob = new Blob([res.data], { type: contentType });
      const photoUrl = window.URL.createObjectURL(blob);

      const win = window.open(photoUrl, '_blank', 'noopener,noreferrer');

      if (!win) {
        setPhotoError(
          'Popup blocked. Please allow popups for this site and try View again.'
        );
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(photoUrl);
      }, 60000);
    } catch (err: any) {
      const status = err?.response?.status;

      if (status === 401) {
        setPhotoError(
          'Photo could not be opened because your admin login token is missing or expired. Please login again.'
        );
      } else if (status === 404) {
        setPhotoError('Photo not found for this delivery.');
      } else {
        setPhotoError('Could not open photo. Please try again.');
      }
    } finally {
      setLoadingPhotoId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Field activity"
        title="Deliveries"
        subtitle="Every flyer drop submitted by reps — who delivered, to which doctor/clinic, the response, GPS fix and proof photo. Newest first."
        actions={
          <span className="badge badge-primary">{total} total</span>
        }
      />

      {photoError ? <div className="alert alert-error">{photoError}</div> : null}

      <div className="card table-card">
        {loading ? (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="loading-row"><span className="spinner" /> Loading deliveries…</span>
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Rep</th>
                <th>Doctor / clinic</th>
                <th>City</th>
                <th>Response</th>
                <th>Route / assignment</th>
                <th>GPS</th>
                <th>Photo</th>
              </tr>
            </thead>

            <tbody>
              {deliveries.map((d) => (
                <tr key={d.DeliveryId}>
                  <td className="cell-nowrap">{new Date(d.SubmittedAt).toLocaleString()}</td>

                  <td className="cell-primary">
                    {d.User_FirstName} {d.User_LastName}
                  </td>

                  <td>
                    <div className="cell-primary">{d.DoctorName || '—'}</div>
                    {d.ClinicName ? <div className="cell-secondary">{d.ClinicName}</div> : null}
                  </td>

                  <td className="cell-nowrap">
                    {[d.DoctorAddressCity, d.DoctorAddressState].filter(Boolean).join(', ') || '—'}
                  </td>

                  <td>
                    <span className={`badge ${responseBadgeClass(d.ResponseStatus)}`}>{d.ResponseStatus || '—'}</span>
                    {d.CompletionStatus ? <div className="cell-secondary">{d.CompletionStatus}</div> : null}
                  </td>

                  <td className="cell-nowrap">
                    <div>Route {d.RouteId || '-'}</div>
                    <div className="cell-secondary">Assignment #{d.AssignmentId || '-'}</div>
                  </td>

                  <td className="cell-mono cell-nowrap">
                    {d.Latitude}, {d.Longitude}
                  </td>

                  <td>
                    {d.HasPhoto ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => viewPhoto(d.DeliveryId)}
                        disabled={loadingPhotoId === d.DeliveryId}
                      >
                        {loadingPhotoId === d.DeliveryId ? 'Opening...' : 'View photo'}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && deliveries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty">No deliveries recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
