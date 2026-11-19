'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../src/services/api';
import './available-routes.css';

type SavedRoute = {
  RouteId: number;
  RouteName: string;
  RouteDate: string | null;
  Status: string;
  StaffUserId: number | null;
  StaffName: string | null;
  StopCount: number;
  DoctorCount?: number;
  FlyerCount?: number;
  CreatedDate: string | null;
};

type Staff = {
  ID: number;
  User_FirstName?: string | null;
  User_LastName?: string | null;
  User_Email?: string | null;
  User_Id?: string | null;
};

type StopFlyer = {
  CampaignName: string | null;
  FlyerTitle: string | null;
};

type StopDoctor = {
  RouteStopId: number;
  DoctorId: number | null;
  TargetName: string | null;
  Specialty: string | null;
  flyers: StopFlyer[];
  completed?: boolean;
};

type StopProof = {
  deliveryId: number;
  submittedAt: string | null;
};

type RouteStop = {
  RouteStopId: number;
  StopOrder: number;
  TargetName: string | null;
  AddressStreet: string | null;
  AddressCity: string | null;
  AddressZip: string | null;
  DoctorCount: number;
  FlyerCount: number;
  flyers: StopFlyer[];
  doctors: StopDoctor[];
  completed?: boolean;
  completedStops?: number;
  totalStops?: number;
  proofs?: StopProof[];
};

function flyerLabel(f: StopFlyer) {
  return (f.FlyerTitle || f.CampaignName || '').trim();
}

function staffName(s: Staff) {
  const n = `${s.User_FirstName ?? ''} ${s.User_LastName ?? ''}`.trim();
  return n || (s.User_Email ?? '') || (s.User_Id ?? '') || `User ${s.ID}`;
}

function stopStatusLabel(s: RouteStop) {
  if (s.completed) return { label: 'Completed', tone: 'completed' as const };
  if (s.completedStops) return { label: `${s.completedStops}/${s.totalStops} done`, tone: 'partial' as const };
  return { label: 'Pending', tone: 'pending' as const };
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  unassigned: { bg: '#fef3c7', color: '#92400e', label: 'Unassigned' },
  draft:      { bg: '#fef3c7', color: '#92400e', label: 'Unassigned' },
  assigned:   { bg: '#dbeafe', color: '#1e40af', label: 'Assigned' },
  completed:  { bg: '#dcfce7', color: '#166534', label: 'Completed' },
  planned:    { bg: '#f1f5f9', color: '#475569', label: 'Planned' }
};

export default function AvailableRoutesPage() {
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assignChoice, setAssignChoice] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [stops, setStops] = useState<Record<number, RouteStop[]>>({});
  const [busy, setBusy] = useState<string>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const flash = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 6000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [routesRes, staffRes] = await Promise.all([
        api.get('/client-workflow/routes/saved'),
        api.get('/client-workflow/staff')
      ]);
      setRoutes(routesRes.data?.routes || []);
      setStaff(staffRes.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not load routes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleStops(routeId: number) {
    if (expanded === routeId) { setExpanded(null); return; }
    setExpanded(routeId);
    if (!stops[routeId]) {
      try {
        const res = await api.get(`/client-workflow/routes/saved/${routeId}`);
        setStops((p) => ({ ...p, [routeId]: res.data?.stops || [] }));
      } catch {
        setStops((p) => ({ ...p, [routeId]: [] }));
      }
    }
  }

  async function assign(route: SavedRoute) {
    const staffUserId = Number(assignChoice[route.RouteId]);
    if (!staffUserId) { setError(`Pick a person for "${route.RouteName}" first.`); return; }
    setBusy(`assign-${route.RouteId}`);
    setError('');
    try {
      await api.post(`/client-workflow/routes/${route.RouteId}/assign`, { staffUserId });
      const person = staff.find((s) => s.ID === staffUserId);
      flash(`"${route.RouteName}" assigned to ${person ? staffName(person) : 'staff'} — now visible in their mobile app.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not assign route.');
    } finally {
      setBusy('');
    }
  }

  async function unassign(route: SavedRoute) {
    setBusy(`unassign-${route.RouteId}`);
    setError('');
    try {
      await api.post(`/client-workflow/routes/${route.RouteId}/unassign`, {});
      flash(`"${route.RouteName}" unassigned. It no longer appears in anyone's mobile app.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not unassign route.');
    } finally {
      setBusy('');
    }
  }

  async function complete(route: SavedRoute) {
    setBusy(`complete-${route.RouteId}`);
    setError('');
    try {
      await api.post(`/client-workflow/routes/${route.RouteId}/complete`, {});
      flash(`"${route.RouteName}" marked completed.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not complete route.');
    } finally {
      setBusy('');
    }
  }

  async function restart(route: SavedRoute) {
    if (!window.confirm(`Restart "${route.RouteName}"? This wipes all delivery progress and proof photos so the route can be run again from scratch. Its locations stay reserved. This cannot be undone.`)) return;
    setBusy(`restart-${route.RouteId}`);
    setError('');
    try {
      const res = await api.post(`/client-workflow/routes/${route.RouteId}/restart`, {});
      const d = res.data || {};
      flash(`"${route.RouteName}" restarted — cleared ${d.deletedDeliveries ?? 0} completion(s) and ${d.deletedPhotos ?? 0} photo(s).`);
      setStops((p) => { const n = { ...p }; delete n[route.RouteId]; return n; });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not restart route.');
    } finally {
      setBusy('');
    }
  }

  async function remove(route: SavedRoute) {
    if (!window.confirm(`Delete "${route.RouteName}"? Its ${route.StopCount} location(s) will become available for new routes. This cannot be undone.`)) return;
    setBusy(`delete-${route.RouteId}`);
    setError('');
    try {
      await api.delete(`/client-workflow/routes/${route.RouteId}`);
      flash(`"${route.RouteName}" deleted — its locations are available again.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not delete route.');
    } finally {
      setBusy('');
    }
  }

  const counts = useMemo(() => {
    const c = { total: routes.length, unassigned: 0, assigned: 0, completed: 0 };
    routes.forEach((r) => {
      if (r.Status === 'unassigned' || r.Status === 'planned' || r.Status === 'draft') c.unassigned++;
      else if (r.Status === 'assigned') c.assigned++;
      else if (r.Status === 'completed') c.completed++;
    });
    return c;
  }, [routes]);

  return (
    <div className="ar-root">
      <header className="ar-page-head">
        <div className="ar-page-intro">
          <p className="ar-eyebrow">Route management</p>
          <h1>Available Routes</h1>
          <p className="ar-lead">Assign saved workflow routes to field staff, track completion, and manage route lifecycle.</p>
        </div>
        <div className="ar-metrics">
          <div className="ar-metric"><span>{counts.total}</span><label>Total</label></div>
          <div className="ar-metric"><span>{counts.unassigned}</span><label>Unassigned</label></div>
          <div className="ar-metric"><span>{counts.assigned}</span><label>Assigned</label></div>
          <div className="ar-metric"><span>{counts.completed}</span><label>Completed</label></div>
        </div>
      </header>

      <div className="ar-toolbar">
        <button type="button" className="ar-btn ghost" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {message ? <div className="ar-banner ok">{message}</div> : null}
        {error ? <div className="ar-banner err">{error}</div> : null}
      </div>

      {!loading && !routes.length ? (
        <div className="ar-empty">
          No saved routes yet. Build a route in <strong>Workflow → Step 2</strong> and click <strong>Save route</strong>.
        </div>
      ) : null}

      <div className="ar-list">
        {routes.map((route) => {
          const st = STATUS_STYLE[route.Status] || STATUS_STYLE.planned;
          const isAssigned = route.Status === 'assigned';
          const isCompleted = route.Status === 'completed';
          return (
            <div key={route.RouteId} className={`ar-card${expanded === route.RouteId ? ' expanded' : ''}`}>
              <div className="ar-card-main">
                <div className="ar-card-info">
                  <div className="ar-card-title">
                    <strong>{route.RouteName}</strong>
                    <span className="ar-status" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  </div>
                  <div className="ar-card-meta">
                    <span>{route.StopCount} locations</span>
                    {route.DoctorCount != null ? <span>{route.DoctorCount} doctors</span> : null}
                    {route.FlyerCount != null ? <span>{route.FlyerCount} flyer drops</span> : null}
                    {route.RouteDate ? <span>{String(route.RouteDate).slice(0, 10)}</span> : null}
                    {route.StaffName ? <span className="ar-assignee">{route.StaffName}</span> : null}
                  </div>
                  <button
                    type="button"
                    className={`ar-expand${expanded === route.RouteId ? ' open' : ''}`}
                    onClick={() => toggleStops(route.RouteId)}
                    aria-expanded={expanded === route.RouteId}
                  >
                    <span className="ar-expand-icon" aria-hidden />
                    {expanded === route.RouteId ? 'Hide stops' : `View ${route.StopCount} stop${route.StopCount === 1 ? '' : 's'}`}
                  </button>
                </div>

                <div className="ar-card-actions">
                  {!isAssigned && !isCompleted ? (
                    <>
                      <select
                        value={assignChoice[route.RouteId] || ''}
                        onChange={(e) => setAssignChoice((p) => ({ ...p, [route.RouteId]: e.target.value }))}
                        aria-label={`Assign ${route.RouteName}`}
                      >
                        <option value="">Select person</option>
                        {staff.map((s) => <option key={s.ID} value={s.ID}>{staffName(s)}</option>)}
                      </select>
                      <button
                        type="button"
                        className="ar-btn primary"
                        onClick={() => assign(route)}
                        disabled={busy === `assign-${route.RouteId}` || !assignChoice[route.RouteId]}
                      >
                        {busy === `assign-${route.RouteId}` ? 'Assigning…' : 'Assign'}
                      </button>
                    </>
                  ) : null}

                  {isAssigned ? (
                    <>
                      <button type="button" className="ar-btn ghost" onClick={() => unassign(route)} disabled={busy === `unassign-${route.RouteId}`}>
                        {busy === `unassign-${route.RouteId}` ? '…' : 'Unassign'}
                      </button>
                      <button type="button" className="ar-btn success" onClick={() => complete(route)} disabled={busy === `complete-${route.RouteId}`}>
                        {busy === `complete-${route.RouteId}` ? '…' : 'Mark completed'}
                      </button>
                    </>
                  ) : null}

                  {isAssigned || isCompleted ? (
                    <button type="button" className="ar-btn ghost" onClick={() => restart(route)} disabled={busy === `restart-${route.RouteId}`}>
                      {busy === `restart-${route.RouteId}` ? '…' : 'Restart'}
                    </button>
                  ) : null}

                  <button type="button" className="ar-btn danger ghost" onClick={() => remove(route)} disabled={busy === `delete-${route.RouteId}`}>
                    {busy === `delete-${route.RouteId}` ? '…' : 'Delete'}
                  </button>
                </div>
              </div>

              {expanded === route.RouteId ? (
                <div className="ar-stops-panel">
                  {!stops[route.RouteId] ? (
                    <div className="ar-stops-loading">
                      <span className="ar-spinner" aria-hidden />
                      Loading stops…
                    </div>
                  ) : stops[route.RouteId].length ? (
                    <>
                      {(() => {
                        const list = stops[route.RouteId];
                        const doneCount = list.filter((s) => s.completed).length;
                        const pct = list.length ? Math.round((doneCount / list.length) * 100) : 0;
                        return (
                          <div className="ar-progress-bar">
                            <div className="ar-progress-meta">
                              <span>Completion</span>
                              <strong>{doneCount} / {list.length} locations · {pct}%</strong>
                            </div>
                            <div className="ar-progress-track">
                              <div className="ar-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })()}

                      <div className="ar-stop-table">
                        <div className="ar-stop-thead">
                          <span>#</span>
                          <span>Location</span>
                          {/* <span>Doctors</span> */}
                          <span>Flyers</span>
                          <span>Status</span>
                          <span>Proof</span>
                        </div>
                        <div className="ar-stop-tbody">
                          {stops[route.RouteId].map((s) => {
                            const address = [s.AddressStreet, s.AddressCity, s.AddressZip].filter(Boolean).join(', ') || 'Address pending';
                            const title = s.TargetName && s.DoctorCount === 1 ? s.TargetName : `Location ${s.StopOrder}`;
                            const status = stopStatusLabel(s);
                            return (
                              <div
                                key={s.RouteStopId}
                                className={`ar-stop-row${status.tone === 'completed' ? ' is-done' : status.tone === 'partial' ? ' is-partial' : ''}`}
                              >
                                <div className="ar-stop-index">
                                  <span className={`ar-index-badge${status.tone === 'completed' ? ' done' : ''}`}>
                                    {status.tone === 'completed' ? '✓' : s.StopOrder}
                                  </span>
                                </div>

                                <div className="ar-stop-location">
                                  <strong>{title}</strong>
                                  <span>{address}</span>
                                </div>

                                {/* <div className="ar-stop-doctors">
                                  {s.doctors?.length ? s.doctors.map((d) => (
                                    <div key={`${d.RouteStopId}-${d.DoctorId ?? d.TargetName}`} className={`ar-doctor-line${d.completed ? ' done' : ''}`}>
                                      <span className={`ar-dot${d.completed ? ' done' : ''}`} aria-hidden />
                                      <span>
                                        {d.TargetName || 'Doctor'}
                                        {d.Specialty ? <em>{d.Specialty}</em> : null}
                                      </span>
                                    </div>
                                  )) : <span className="ar-muted">—</span>}
                                </div> */}

                                <div className="ar-stop-flyers">
                                  {s.flyers?.length ? s.flyers.map((f, i) => (
                                    <span key={i} className="ar-tag">{flyerLabel(f) || 'Flyer'}</span>
                                  )) : <span className="ar-muted">—</span>}
                                </div>

                                <div className="ar-stop-status">
                                  <span className={`ar-pill ${status.tone}`}>{status.label}</span>
                                </div>

                                <div className="ar-stop-proof">
                                  {s.proofs?.length ? s.proofs.map((p) => (
                                    <ProofThumb key={p.deliveryId} deliveryId={p.deliveryId} submittedAt={p.submittedAt} />
                                  )) : <span className="ar-muted">—</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="ar-stops-empty">No stops on this route.</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Loads a proof photo (which sits behind an authenticated endpoint) as a blob
// via the axios client, then renders it as an object URL. Click opens full size.
function ProofThumb({ deliveryId, submittedAt }: { deliveryId: number; submittedAt?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    api
      .get(`/deliveries/${deliveryId}/photo`, { responseType: 'blob' })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => { /* leave placeholder */ });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deliveryId]);

  const dateLabel = submittedAt ? String(submittedAt).slice(0, 10) : null;

  if (!url) {
    return (
      <div className="ar-proof-wrap">
        <div className="ar-proof-loading" aria-label="Loading proof photo" />
      </div>
    );
  }
  return (
    <div className="ar-proof-wrap">
      <button
        type="button"
        className="ar-proof"
        onClick={() => window.open(url, '_blank')}
        title={dateLabel ? `Proof photo · ${dateLabel}` : 'View proof photo'}
      >
        <img src={url} alt="Proof of delivery" />
      </button>
    </div>
  );
}
