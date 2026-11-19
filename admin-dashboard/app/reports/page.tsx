'use client';
import { useState } from 'react';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';

const PREVIEW_COLUMNS = [
  'SubmittedAt',
  'StaffName',
  'CampaignName',
  'DoctorName',
  'ClinicName',
  'DoctorAddressCity',
  'ResponseStatus',
  'FlyerDelivered',
  'HasPhoto',
];
const PREVIEW_ROWS = 15;

function cell(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return String(value);
}

export default function ReportsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/export');
      setRows(res.data);
      setLoaded(true);
    } catch (err: any) {
      if (err?.response?.status !== 401) setError(err?.response?.data?.message || 'Could not load the delivery report.');
    } finally {
      setLoading(false);
    }
  }
  function downloadCsv() {
    const headers = Object.keys(rows[0] || {});
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'flyer-deliveries.csv'; a.click();
  }

  const columns = PREVIEW_COLUMNS.filter((c) => rows.length === 0 || c in rows[0]);

  return (
    <div>
      <PageHeader
        eyebrow="Data & reports"
        title="Reports"
        subtitle="Delivery export — load the latest delivery records (up to 5,000, newest first) with flyer, rep, doctor, status and GPS columns, then download them as CSV."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : loaded ? 'Reload report' : 'Load report'}
            </button>
            <button type="button" onClick={downloadCsv} disabled={!rows.length}>
              Download CSV
            </button>
          </>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {!loaded && !loading ? (
        <div className="card">
          <div className="empty-state">
            <strong>No report loaded yet</strong>
            <p>Click <b>Load report</b> to pull the delivery export from the server. Nothing is downloaded until you choose <b>Download CSV</b>.</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="card">
          <span className="loading-row"><span className="spinner" /> Loading delivery report…</span>
        </div>
      ) : null}

      {loaded && !loading ? (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <div className="kpi-card">
              <span className="kpi-label">Rows loaded</span>
              <span className="kpi-value">{rows.length}</span>
              <span className="kpi-hint">Ready for CSV download</span>
            </div>
            <div className="kpi-card" style={{ ['--kpi-accent' as any]: '#16a34a' }}>
              <span className="kpi-label">Flyers delivered</span>
              <span className="kpi-value">{rows.filter((r) => Boolean(r.FlyerDelivered)).length}</span>
              <span className="kpi-hint">In the loaded rows</span>
            </div>
            <div className="kpi-card" style={{ ['--kpi-accent' as any]: '#7c3aed' }}>
              <span className="kpi-label">With photo</span>
              <span className="kpi-value">{rows.filter((r) => Boolean(r.HasPhoto)).length}</span>
              <span className="kpi-hint">Proof photo attached</span>
            </div>
            <div className="kpi-card" style={{ ['--kpi-accent' as any]: '#f59e0b' }}>
              <span className="kpi-label">Columns</span>
              <span className="kpi-value">{Object.keys(rows[0] || {}).length}</span>
              <span className="kpi-hint">Included in the CSV</span>
            </div>
          </div>

          <div className="card table-card">
            <div className="card-head" style={{ padding: '16px 20px 0' }}>
              <div>
                <h2>Preview</h2>
                <p>First {Math.min(PREVIEW_ROWS, rows.length)} of {rows.length} rows · key columns only. The CSV contains every column.</p>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="table-empty">The export returned no rows.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {columns.map((c) => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <tr key={r.DeliveryId ?? i}>
                        {columns.map((c) => <td key={c}>{cell(r[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
