'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../src/services/api';
import type { Market } from '../../src/types/location';
import type { Campaign } from '../../src/types/campaign';
import type { RouteMapData } from '../../src/components/RoutePreviewMap';

const RoutePreviewMap = dynamic(
  () => import('../../src/components/RoutePreviewMap'),
  {
    ssr: false,
    loading: () => (
      <div className="map-loading">
        <div className="map-loader" />
        <span>Loading route map...</span>
      </div>
    ),
  },
);

type Distributor = {
  userId: number;
  fullName: string;
  homeAddress: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
};

type AssignableTarget = {
  CampaignTargetId: number;
  TargetName?: string | null;
  AssignedFlyerName?: string | null;
  PrimaryAddress?: string | null;
  City?: string | null;
  TargetType?: string | null;
  VisitFrequencyType?: string | null;
  VisitFrequencyDays?: number | null;
  LastVisitedAt?: string | null;
  NextDueDate?: string | null;
  VisitDueStatus?: string | null;
};

type RouteStop = {
  RouteStopId: number;
  StopOrder: number;
  StopLabel?: string | null;
  StopAddress?: string | null;
  AssignedFlyerName?: string | null;
  TargetType: string;
  Status: string;
  VisitFrequencyType?: string | null;
  VisitFrequencyDays?: number | null;
  TargetLastVisitedAt?: string | null;
  TargetNextDueDate?: string | null;
  VisitDueStatus?: string | null;
};

type RouteRow = {
  RouteId: number;
  RouteName: string;
  RouteDate: string;
  DistributorUserId: number | null;
  MarketId: number | null;
  StartType: string;
  StartAddress: string | null;
  StartLatitude: number | null;
  StartLongitude: number | null;
  Status: string;
  MarketName?: string | null;
  DistributorName?: string | null;
  StopCount: number;
  CompletedStopCount: number;
  stops?: RouteStop[];
  mapData?: RouteMapData;
};

const emptyForm = {
  routeName: '',
  routeDate: new Date().toISOString().slice(0, 10),
  distributorUserId: '',
  marketId: '',
  startType: 'home',
  startAddress: '',
  startLatitude: '',
  startLongitude: '',
  campaignId: '',
};

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assignableTargets, setAssignableTargets] = useState<AssignableTarget[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<number[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [visitDueFilter, setVisitDueFilter] = useState('');
  const [allowEarlyAssignment, setAllowEarlyAssignment] = useState(false);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.RouteId === selectedRouteId) || null,
    [routes, selectedRouteId],
  );

  async function loadMeta() {
    const [distributorRes, marketRes, campaignRes] = await Promise.all([
      api.get('/distributors'),
      api.get('/markets'),
      api.get('/campaigns'),
    ]);
    setDistributors(distributorRes.data);
    setMarkets(marketRes.data);
    setCampaigns(campaignRes.data);
  }

  async function loadRoutes() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/routes', {
        params: {
          routeDate: filterDate || undefined,
          status: filterStatus || undefined,
        },
      });
      setRoutes(res.data.routes || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not load routes.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRouteDetail(routeId: number) {
    const res = await api.get(`/routes/${routeId}`);
    const detail = res.data as RouteRow;
    setRoutes((current) => current.map((r) => (r.RouteId === routeId ? { ...r, ...detail } : r)));
    setSelectedRouteId(routeId);
  }

  async function loadAssignableTargets(campaignId: string) {
    if (!campaignId) {
      setAssignableTargets([]);
      return;
    }
    const res = await api.get('/campaign-targets/assignable', {
      params: {
        campaignId,
        visitDueFilter: visitDueFilter || undefined,
        prioritizeDue: 'true',
      },
    });
    setAssignableTargets(res.data.targets || []);
  }

  useEffect(() => {
    loadMeta().catch(() => setError('Could not load distributors/markets.'));
    loadRoutes();
  }, []);

  useEffect(() => {
    loadRoutes();
  }, [filterDate, filterStatus]);

  async function createRoute(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      const payload = {
        routeName: form.routeName.trim(),
        routeDate: form.routeDate,
        distributorUserId: form.distributorUserId ? Number(form.distributorUserId) : null,
        marketId: form.marketId ? Number(form.marketId) : null,
        startType: form.startType,
        startAddress: form.startType === 'custom' ? form.startAddress || null : null,
        startLatitude: form.startType === 'custom' && form.startLatitude ? Number(form.startLatitude) : null,
        startLongitude: form.startType === 'custom' && form.startLongitude ? Number(form.startLongitude) : null,
      };
      const res = await api.post('/routes', payload);
      setMessage(`Created ${res.data.RouteName}`);
      setForm({ ...emptyForm, routeDate: form.routeDate });
      await loadRoutes();
      if (res.data.RouteId) await loadRouteDetail(res.data.RouteId);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create route.');
    }
  }

  async function addStops() {
    if (!selectedRouteId || !selectedTargetIds.length) return;
    setMessage('');
    setError('');
    try {
      const res = await api.post(`/routes/${selectedRouteId}/stops`, {
        campaignTargetIds: selectedTargetIds,
        allowEarlyAssignment,
      });
      setMessage(`Added ${res.data.addedCount} stop(s).`);
      setSelectedTargetIds([]);
      await loadRouteDetail(selectedRouteId);
      await loadRoutes();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not add stops.');
    }
  }

  async function moveStop(stopId: number, direction: 'up' | 'down') {
    if (!selectedRoute?.stops?.length) return;
    const stops = [...selectedRoute.stops].sort((a, b) => a.StopOrder - b.StopOrder);
    const index = stops.findIndex((s) => s.RouteStopId === stopId);
    if (index < 0) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= stops.length) return;
    [stops[index], stops[swapIndex]] = [stops[swapIndex], stops[index]];
    const stopIds = stops.map((s) => s.RouteStopId);
    const res = await api.put(`/routes/${selectedRoute.RouteId}/stops/reorder`, { stopIds });
    setRoutes((current) => current.map((r) => (r.RouteId === selectedRoute.RouteId ? res.data : r)));
  }

  async function sortNearest() {
    if (!selectedRouteId) return;
    setMessage('');
    setError('');
    try {
      const res = await api.post(`/routes/${selectedRouteId}/stops/sort-nearest`);
      setMessage('Stops sorted by nearest distance from start.');
      setRoutes((current) => current.map((r) => (r.RouteId === selectedRouteId ? res.data : r)));
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not sort stops.');
    }
  }

  async function updateSelectedDistributor(distributorUserId: string) {
    if (!selectedRoute) return;
    try {
      const res = await api.put(`/routes/${selectedRoute.RouteId}`, {
        distributorUserId: distributorUserId ? Number(distributorUserId) : null,
      });
      setRoutes((current) => current.map((r) => (r.RouteId === selectedRoute.RouteId ? { ...r, ...res.data } : r)));
      setMessage('Distributor updated.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not update distributor.');
    }
  }

  async function assignRoute() {
    if (!selectedRoute) return;
    setMessage('');
    setError('');
    try {
      const res = await api.post(`/routes/${selectedRoute.RouteId}/assign`, {
        distributorUserId: selectedRoute.DistributorUserId,
      });
      setMessage(`Route assigned to ${res.data.DistributorName || 'distributor'}.`);
      await loadRouteDetail(selectedRoute.RouteId);
      await loadRoutes();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not assign route.');
    }
  }

  async function cancelRoute() {
    if (!selectedRoute) return;
    if (!window.confirm(`Cancel route "${selectedRoute.RouteName}"?`)) return;
    setMessage('');
    setError('');
    try {
      await api.post(`/routes/${selectedRoute.RouteId}/cancel`);
      setMessage('Route cancelled.');
      await loadRouteDetail(selectedRoute.RouteId);
      await loadRoutes();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not cancel route.');
    }
  }

  async function completeStop(stopId: number) {
    if (!selectedRoute) return;
    setMessage('');
    setError('');
    try {
      const res = await api.post(`/routes/${selectedRoute.RouteId}/stops/${stopId}/complete`, { status: 'completed' });
      setMessage('Stop marked completed; visit schedule updated.');
      setRoutes((current) => current.map((r) => (r.RouteId === selectedRoute.RouteId ? res.data : r)));
      await loadRoutes();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not complete stop.');
    }
  }

  async function removeStop(stopId: number) {
    if (!selectedRoute) return;
    const res = await api.delete(`/routes/${selectedRoute.RouteId}/stops/${stopId}`);
    setRoutes((current) => current.map((r) => (r.RouteId === selectedRoute.RouteId ? res.data : r)));
    await loadRoutes();
  }

  const selectedDistributor = distributors.find((d) => String(d.userId) === form.distributorUserId);

  return (
    <div>
      <h1>Routes</h1>
      <p>Create multiple delivery routes from distributor home to approved doctor/pharmacy stops.</p>

      <form className="form-grid" onSubmit={createRoute}>
        <h2 style={{ gridColumn: '1 / -1' }}>Create route</h2>
        <input
          placeholder="Route name (e.g. Route 1)"
          value={form.routeName}
          onChange={(e) => setForm({ ...form, routeName: e.target.value })}
          required
        />
        <input type="date" value={form.routeDate} onChange={(e) => setForm({ ...form, routeDate: e.target.value })} required />
        <select
          value={form.distributorUserId}
          onChange={(e) => setForm({ ...form, distributorUserId: e.target.value })}
        >
          <option value="">Select distributor (optional until assign)</option>
          {distributors.map((d) => (
            <option key={d.userId} value={d.userId}>{d.fullName}</option>
          ))}
        </select>
        <select value={form.marketId} onChange={(e) => setForm({ ...form, marketId: e.target.value })}>
          <option value="">Select market</option>
          {markets.map((m) => (
            <option key={m.MarketId} value={m.MarketId}>{m.MarketName}</option>
          ))}
        </select>
        <select value={form.startType} onChange={(e) => setForm({ ...form, startType: e.target.value })}>
          <option value="home">Start: distributor home</option>
          <option value="current">Start: current location</option>
          <option value="custom">Start: custom address</option>
        </select>
        {form.startType === 'custom' ? (
          <>
            <input placeholder="Custom start address" value={form.startAddress} onChange={(e) => setForm({ ...form, startAddress: e.target.value })} />
            <input placeholder="Latitude" value={form.startLatitude} onChange={(e) => setForm({ ...form, startLatitude: e.target.value })} />
            <input placeholder="Longitude" value={form.startLongitude} onChange={(e) => setForm({ ...form, startLongitude: e.target.value })} />
          </>
        ) : null}
        {form.startType === 'home' && selectedDistributor ? (
          <p style={{ gridColumn: '1 / -1', margin: 0, color: '#475569' }}>
            Home: {selectedDistributor.homeAddress || 'Not set'} ·{' '}
            {selectedDistributor.homeLatitude != null ? `${selectedDistributor.homeLatitude}, ${selectedDistributor.homeLongitude}` : 'No coordinates'}
          </p>
        ) : null}
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit">Create route</button>
        </div>
      </form>

      <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
        <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="assigned">Assigned</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button type="button" onClick={loadRoutes}>Refresh</button>
      </div>

      {message ? <p style={{ color: '#047857' }}>{message}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {loading ? <p>Loading routes...</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Distributor</th>
                <th>Status</th>
                <th>Stops</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.RouteId} style={route.RouteId === selectedRouteId ? { background: '#f0fdf4' } : undefined}>
                  <td>{route.RouteName}</td>
                  <td>{String(route.RouteDate).slice(0, 10)}</td>
                  <td>{route.DistributorName || '—'}</td>
                  <td>{route.Status}</td>
                  <td>{route.CompletedStopCount}/{route.StopCount}</td>
                  <td>
                    <button type="button" onClick={() => loadRouteDetail(route.RouteId)}>Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          {selectedRoute ? (
            <div>
              <h2>{selectedRoute.RouteName}</h2>
              <p>
                {selectedRoute.Status} · {selectedRoute.StopCount} stops · start: {selectedRoute.StartType}
                {selectedRoute.StartAddress ? ` · ${selectedRoute.StartAddress}` : ''}
              </p>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Distributor{' '}
                <select
                  value={selectedRoute.DistributorUserId != null ? String(selectedRoute.DistributorUserId) : ''}
                  onChange={(e) => updateSelectedDistributor(e.target.value)}
                >
                  <option value="">Select distributor</option>
                  {distributors.map((d) => (
                    <option key={d.userId} value={d.userId}>{d.fullName}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" onClick={assignRoute} disabled={selectedRoute.Status === 'cancelled' || selectedRoute.Status === 'completed'}>
                  Assign to distributor
                </button>
                <button type="button" onClick={sortNearest}>Sort nearest</button>
                <button type="button" onClick={cancelRoute} disabled={selectedRoute.Status === 'cancelled'}>
                  Cancel route
                </button>
              </div>

              <div style={{ height: 280, marginBottom: 16, border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}>
                <RoutePreviewMap mapData={selectedRoute.mapData || null} />
              </div>

              <h3>Stops</h3>
              {selectedRoute.stops?.length ? (
                <ol>
                  {selectedRoute.stops.map((stop) => (
                    <li key={stop.RouteStopId} style={{ marginBottom: 10 }}>
                      <strong>#{stop.StopOrder} {stop.StopLabel || stop.TargetType}</strong>
                      <br />
                      Flyer: {stop.AssignedFlyerName || '—'}
                      <br />
                      Visit: {stop.VisitFrequencyType || '—'}
                      {stop.VisitFrequencyDays ? ` (${stop.VisitFrequencyDays}d)` : ''}
                      · {stop.VisitDueStatus || '—'}
                      <br />
                      Last visited: {stop.TargetLastVisitedAt ? String(stop.TargetLastVisitedAt).slice(0, 10) : '—'}
                      · Next due: {stop.TargetNextDueDate || '—'}
                      <br />
                      {stop.StopAddress || 'Address pending'} · {stop.Status}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => moveStop(stop.RouteStopId, 'up')}>Up</button>
                        <button type="button" onClick={() => moveStop(stop.RouteStopId, 'down')}>Down</button>
                        {stop.Status === 'pending' ? (
                          <button type="button" onClick={() => completeStop(stop.RouteStopId)}>Complete visit</button>
                        ) : null}
                        <button type="button" onClick={() => removeStop(stop.RouteStopId)}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No stops yet. Add approved campaign targets below.</p>
              )}

              <div style={{ marginTop: 16 }}>
                <h3>Add approved targets</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <select
                    value={form.campaignId}
                    onChange={(e) => {
                      setForm({ ...form, campaignId: e.target.value });
                      loadAssignableTargets(e.target.value);
                    }}
                  >
                    <option value="">Select campaign</option>
                    {campaigns.map((c) => (
                      <option key={c.CampaignId} value={c.CampaignId}>{c.CampaignName}</option>
                    ))}
                  </select>
                  <select value={visitDueFilter} onChange={(e) => {
                    setVisitDueFilter(e.target.value);
                    if (form.campaignId) loadAssignableTargets(form.campaignId);
                  }}>
                    <option value="">All due schedules</option>
                    <option value="due_now">Due now</option>
                    <option value="overdue">Overdue</option>
                    <option value="upcoming">Upcoming</option>
                  </select>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={allowEarlyAssignment}
                      onChange={(e) => setAllowEarlyAssignment(e.target.checked)}
                    />
                    Allow early assignment (not due yet)
                  </label>
                </div>
                {assignableTargets.length ? (
                  <ul>
                    {assignableTargets.map((target) => (
                      <li key={target.CampaignTargetId}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selectedTargetIds.includes(target.CampaignTargetId)}
                            onChange={() => setSelectedTargetIds((current) =>
                              current.includes(target.CampaignTargetId)
                                ? current.filter((id) => id !== target.CampaignTargetId)
                                : [...current, target.CampaignTargetId],
                            )}
                          />
                          {target.TargetName || 'Target'} · {target.AssignedFlyerName || 'Flyer'}
                          · {target.VisitDueStatus || '—'}
                          · next {target.NextDueDate || '—'}
                          · {[target.PrimaryAddress, target.City].filter(Boolean).join(', ')}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Select a campaign to load approved targets.</p>
                )}
                <button type="button" onClick={addStops} disabled={!selectedTargetIds.length}>Add selected stops</button>
              </div>
            </div>
          ) : (
            <p>Select a route to manage stops, assign distributor, and preview map.</p>
          )}
        </div>
      </div>
    </div>
  );
}
