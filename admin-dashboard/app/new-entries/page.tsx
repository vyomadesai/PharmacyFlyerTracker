'use client';

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '../../src/components/PageHeader';
import Pagination from '../../src/components/Pagination';
import { api } from '../../src/services/api';
import { DEFAULT_PAGE_SIZE, type PaginatedResponse } from '../../src/types/pagination';

type NewEntryRow = {
  AppNewEntryId: number;
  PracticeName: string;
  LocationAddress: string;
  ProviderName: string;
  ProviderAddress: string;
  NpiNumber?: string | null;
  Phone?: string | null;
  TaxonomyCode?: string | null;
  TaxonomyDesc?: string | null;
  PrimaryTaxonomy?: string | null;
  SelectedTaxonomy?: string | null;
  TaxonomyState?: string | null;
  LicenseNumber?: string | null;
  CampaignId?: number | null;
  FlyerTitle?: string | null;
  FlyerDropped?: boolean | number;
  Latitude?: number | string | null;
  Longitude?: number | string | null;
  Status?: string;
  SubmittedAt: string;
  User_FirstName?: string;
  User_LastName?: string;
  HasPhoto?: boolean | number;
};

export default function NewEntriesPage() {
  const [entries, setEntries] = useState<NewEntryRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingPhotoId, setLoadingPhotoId] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState('');

  const loadEntries = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<NewEntryRow>>('/new-entries', {
        params: { page: nextPage, pageSize: DEFAULT_PAGE_SIZE },
      });
      setEntries(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries(page);
  }, [loadEntries, page]);

  async function viewPhoto(entryId: number) {
    setPhotoError('');
    setLoadingPhotoId(entryId);

    try {
      const res = await api.get(`/new-entries/${entryId}/photo`, {
        responseType: 'blob',
      });
      const headerContentType = res.headers['content-type'];
      const contentType =
        typeof headerContentType === 'string' ? headerContentType : 'image/jpeg';

      const blob = new Blob([res.data], { type: contentType });
      const photoUrl = window.URL.createObjectURL(blob);
      const win = window.open(photoUrl, '_blank', 'noopener,noreferrer');

      if (!win) {
        setPhotoError('Popup blocked. Please allow popups and try again.');
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(photoUrl);
      }, 60000);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setPhotoError('Login expired. Please sign in again.');
      } else if (status === 404) {
        setPhotoError('Photo not found for this entry.');
      } else {
        setPhotoError('Could not open photo.');
      }
    } finally {
      setLoadingPhotoId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Field activity"
        title="New Entries"
        subtitle="Provider and practice details captured by reps when they save a visit in the mobile app (Smart Route visit save / Add New), including the flyer dropped and the business-card photo."
        actions={<span className="badge badge-primary">{total} total</span>}
      />

      {photoError ? <div className="alert alert-error">{photoError}</div> : null}

      <div className="card table-card">
        {loading ? (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="loading-row"><span className="spinner" /> Loading entries…</span>
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date / time</th>
                <th>Rep</th>
                <th>Practice / location</th>
                <th>Provider</th>
                <th>Taxonomy</th>
                <th>Flyer</th>
                <th>Card photo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.AppNewEntryId}>
                  <td className="cell-nowrap">{new Date(row.SubmittedAt).toLocaleString()}</td>
                  <td className="cell-primary">
                    {row.User_FirstName} {row.User_LastName}
                  </td>
                  <td>
                    <div className="cell-primary">{row.PracticeName || '—'}</div>
                    <div className="cell-secondary">{row.LocationAddress || '—'}</div>
                  </td>
                  <td>
                    <div className="cell-primary">{row.ProviderName || '—'}</div>
                    <div className="cell-secondary">
                      <span className="cell-mono">NPI {row.NpiNumber || '—'}</span>
                      {row.ProviderAddress ? ` · ${row.ProviderAddress}` : ''}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>
                      <span className="muted">Primary:</span> {row.PrimaryTaxonomy || '—'}
                    </div>
                    <div style={{ fontSize: 12.5 }}>
                      <span className="muted">Selected:</span> {row.SelectedTaxonomy || row.TaxonomyDesc || '—'}
                    </div>
                    <div className="cell-secondary">
                      State {row.TaxonomyState || '—'} · License {row.LicenseNumber || '—'}
                    </div>
                  </td>
                  <td>
                    <div>{row.FlyerTitle || '—'}</div>
                    {row.FlyerDropped ? (
                      <span className="badge badge-success badge-dot" style={{ marginTop: 4 }}>Dropped</span>
                    ) : null}
                  </td>
                  <td>
                    {row.HasPhoto ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => viewPhoto(row.AppNewEntryId)}
                        disabled={loadingPhotoId === row.AppNewEntryId}
                      >
                        {loadingPhotoId === row.AppNewEntryId ? 'Opening…' : 'View card'}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">No entries yet. Entries appear when reps save a visit from the mobile app.</td>
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
