'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';
import AddressAutocomplete from '../../src/components/AddressAutocomplete';
import type { CoveragePoint } from '../../src/components/RoutePlannerCoverageMap';

const RoutePlannerCoverageMap = dynamic(
  () => import('../../src/components/RoutePlannerCoverageMap'),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#64748b' }}>
        Loading map…
      </div>
    ),
  },
);

type FlyerSpecialtyRow = {
  specialityCode: string | null;
  description: string | null;
  matchLevel: string;
};

type RoutePlannerFlyer = {
  campaignId: number;
  campaignName: string;
  flyerTitle?: string | null;
  description?: string | null;
  specialties: FlyerSpecialtyRow[];
};

type TerritoryResolved = {
  centerLabel: string | null;
  centerAddress: string | null;
  centerLatitude: number;
  centerLongitude: number;
  radiusMiles: number;
};

type TerritoryState = {
  centerAddress: string;
  radiusMiles: string;
};

type StopDoctor = {
  doctorId: number;
  doctorName: string;
  matchedSpecialityCode: string | null;
  matchedLevel: string | null;
};

type LocationStop = {
  locationKey: string;
  stopLabel: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  doctorCount: number;
  doctors: StopDoctor[];
  visitFrequencyDays: number;
  lastVisitDate: string | null;
  nextVisitDate: string | null;
  isDue: boolean;
};

type StopsResponse = {
  campaignId: number;
  campaignName: string;
  doctorCount: number;
  locationCount: number;
  radiusMiles?: number | null;
  coverage?: { totalLocations: number; dueLocations: number; notDueLocations: number } | null;
  startPoint?: {
    startType: string;
    startLabel: string | null;
    centerLatitude?: number | null;
    centerLongitude?: number | null;
  } | null;
  territory?: TerritoryResolved | null;
  stops: LocationStop[];
};

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const TERRITORY_RADIUS_OPTIONS = [10, 15, 20, 25, 30, 40, 50];

function flyerTabLabel(f: RoutePlannerFlyer) {
  return f.flyerTitle || f.campaignName;
}

function specialtySummary(flyer: RoutePlannerFlyer) {
  if (!flyer.specialties.length) return 'No specialties';
  return flyer.specialties
    .map((s) => {
      const code = s.specialityCode || '';
      const desc = s.description || '';
      return code && desc && code !== desc ? `${code} — ${desc}` : desc || code;
    })
    .join('; ');
}

function formatAddress(stop: LocationStop) {
  const line1 = stop.addressStreet || '';
  const line2 = [stop.addressCity, stop.addressState, stop.addressZip].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(' · ') || '—';
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function withVisitSchedule(stop: LocationStop, visitFrequencyDays: number): LocationStop {
  const nextVisitDate = stop.lastVisitDate ? addDaysIso(stop.lastVisitDate, visitFrequencyDays) : null;
  return {
    ...stop,
    visitFrequencyDays,
    nextVisitDate,
    isDue: nextVisitDate == null || nextVisitDate <= TODAY_ISO,
  };
}

function normalizePhone(value: string | null | undefined) {
  return String(value || '').replace(/\D/g, '');
}

function stopMatchesLocationFilter(stop: LocationStop, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    stop.stopLabel,
    stop.addressStreet,
    stop.addressCity,
    stop.addressState,
    stop.addressZip,
    formatAddress(stop),
    ...stop.doctors.map((d) => d.doctorName),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function stopMatchesPhoneFilter(stop: LocationStop, query: string) {
  const digits = normalizePhone(query);
  if (!digits) return true;
  const phone = normalizePhone(stop.phone);
  return phone.includes(digits);
}

export default function RoutePlannerPage() {
  const router = useRouter();
  const [flyers, setFlyers] = useState<RoutePlannerFlyer[]>([]);
  const [selectedFlyerId, setSelectedFlyerId] = useState('');
  const [territoryResolved, setTerritoryResolved] = useState<TerritoryResolved | null>(null);
  const [territoryForm, setTerritoryForm] = useState<TerritoryState>({
    centerAddress: '',
    radiusMiles: '30',
  });
  const [savingTerritory, setSavingTerritory] = useState(false);
  const [territoryVersion, setTerritoryVersion] = useState(0);
  const [centroidPanelOpen, setCentroidPanelOpen] = useState(false);

  const [stops, setStops] = useState<LocationStop[]>([]);
  const [meta, setMeta] = useState<StopsResponse | null>(null);
  const [savingFreqKey, setSavingFreqKey] = useState<string | null>(null);
  const [freqEdits, setFreqEdits] = useState<Record<string, string>>({});
  const [view, setView] = useState<'both' | 'map' | 'table'>('both');
  const [expandedStop, setExpandedStop] = useState<string | null>(null);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');

  const [loadingFlyers, setLoadingFlyers] = useState(true);
  const [loadingTerritory, setLoadingTerritory] = useState(true);
  const [loadingStops, setLoadingStops] = useState(false);
  const [error, setError] = useState('');

  const loadFlyers = useCallback(async () => {
    setLoadingFlyers(true);
    try {
      const res = await api.get<RoutePlannerFlyer[]>('/route-planner/campaigns');
      setFlyers(res.data);
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load flyers.');
      }
    } finally {
      setLoadingFlyers(false);
    }
  }, []);

  const loadTerritory = useCallback(async () => {
    setLoadingTerritory(true);
    try {
      const res = await api.get<{
        territory: {
          pharmacyId: number | null;
          centerLabel: string | null;
          centerAddress: string | null;
          radiusMiles: number;
        };
        resolved: TerritoryResolved | null;
        configured: boolean;
        error?: string | null;
      }>('/route-planner/territory');

      setTerritoryResolved(res.data.resolved);
      const t = res.data.territory;
      setTerritoryForm({
        centerAddress: res.data.resolved?.centerAddress || t.centerAddress || '',
        radiusMiles: String(t.radiusMiles || 30),
      });
      setCentroidPanelOpen(!res.data.resolved);
      if (!res.data.configured && res.data.error) {
        setError(res.data.error);
      }
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load territory.');
      }
    } finally {
      setLoadingTerritory(false);
    }
  }, []);

  const fetchStops = useCallback(async (flyerId: string, signal?: AbortSignal) => {
    if (!flyerId) return;
    setLoadingStops(true);
    setError('');
    try {
      const stopsRes = await api.get<StopsResponse>(`/route-planner/campaigns/${flyerId}/stops`, { signal });
      setStops(stopsRes.data.stops || []);
      setMeta(stopsRes.data);
      setExpandedStop(null);
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      setStops([]);
      setMeta(null);
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load locations.');
      }
    } finally {
      setLoadingStops(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.push('/');
      return;
    }
    loadFlyers();
    loadTerritory();
  }, [router, loadFlyers, loadTerritory]);

  useEffect(() => {
    if (flyers.length && !selectedFlyerId) {
      setSelectedFlyerId(String(flyers[0].campaignId));
    }
  }, [flyers, selectedFlyerId]);

  useEffect(() => {
    if (!selectedFlyerId || !territoryResolved) return;
    const controller = new AbortController();
    fetchStops(selectedFlyerId, controller.signal);
    return () => controller.abort();
  }, [selectedFlyerId, territoryVersion, fetchStops, territoryResolved?.centerLatitude, territoryResolved?.radiusMiles]);

  const selectedFlyer = flyers.find((f) => String(f.campaignId) === selectedFlyerId);

  function onSelectFlyer(flyerId: string) {
    setSelectedFlyerId(flyerId);
    setSelectedStop(null);
  }

  function closeCentroidPanel() {
    setCentroidPanelOpen(false);
    if (territoryResolved) {
      setTerritoryForm({
        centerAddress: territoryResolved.centerAddress || '',
        radiusMiles: String(territoryResolved.radiusMiles),
      });
    }
    setError('');
  }

  async function saveCentroid() {
    const address = territoryForm.centerAddress.trim();
    if (!address) {
      setError('Enter a center address.');
      return;
    }
    setSavingTerritory(true);
    setError('');
    try {
      const res = await api.put('/route-planner/territory', {
        centerAddress: address,
        radiusMiles: Number(territoryForm.radiusMiles) || 30,
      });
      setTerritoryResolved(res.data.resolved);
      setTerritoryVersion((v) => v + 1);
      setCentroidPanelOpen(false);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save centroid.');
    } finally {
      setSavingTerritory(false);
    }
  }

  function freqInputValue(locationKey: string, savedDays: number) {
    return freqEdits[locationKey] ?? String(savedDays);
  }

  function changeStopFrequency(locationKey: string, value: string) {
    const cleaned = value.replace(/[^\d]/g, '');
    setFreqEdits((prev) => ({ ...prev, [locationKey]: cleaned }));

    const days = Number(cleaned);
    if (Number.isFinite(days) && days > 0) {
      setStops((prev) =>
        prev.map((s) => (s.locationKey === locationKey ? withVisitSchedule(s, Math.floor(days)) : s)),
      );
    }
  }

  async function saveStopFrequency(locationKey: string, rawValue: string) {
    const days = Number(rawValue);
    if (!Number.isFinite(days) || days <= 0) {
      setError('Visit frequency must be a positive number.');
      return;
    }
    const visitFrequencyDays = Math.floor(days);
    setSavingFreqKey(locationKey);
    setError('');
    try {
      await api.put('/route-planner/locations/visit-frequency', { locationKey, visitFrequencyDays });
      setStops((prev) =>
        prev.map((s) => (s.locationKey === locationKey ? withVisitSchedule(s, visitFrequencyDays) : s)),
      );
      setFreqEdits((prev) => {
        const next = { ...prev };
        delete next[locationKey];
        return next;
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save visit frequency.');
    } finally {
      setSavingFreqKey(null);
    }
  }

  function focusStopOnMap(locationKey: string, hasCoords: boolean) {
    if (!hasCoords) return;
    if (view === 'table') setView('both');
    setSelectedStop(null);
    requestAnimationFrame(() => setSelectedStop(locationKey));
  }

  const filteredStops = useMemo(
    () =>
      stops.filter(
        (s) => stopMatchesLocationFilter(s, locationFilter) && stopMatchesPhoneFilter(s, phoneFilter),
      ),
    [stops, locationFilter, phoneFilter],
  );

  const hasActiveFilters = Boolean(locationFilter.trim() || phoneFilter.trim());

  const mapPoints: CoveragePoint[] = useMemo(
    () =>
      filteredStops
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({
          key: s.locationKey,
          lat: Number(s.latitude),
          lng: Number(s.longitude),
          label: s.stopLabel,
          address: formatAddress(s),
          phone: s.phone,
          doctorCount: s.doctorCount,
          doctors: s.doctors.map((d) => d.doctorName),
        })),
    [filteredStops],
  );

  const mapCenter =
    territoryResolved
      ? { lat: territoryResolved.centerLatitude, lng: territoryResolved.centerLongitude }
      : meta?.startPoint?.centerLatitude != null && meta?.startPoint?.centerLongitude != null
        ? { lat: Number(meta.startPoint.centerLatitude), lng: Number(meta.startPoint.centerLongitude) }
        : null;
  const mapRadiusMiles = territoryResolved?.radiusMiles ?? meta?.radiusMiles ?? null;

  const showMap = view === 'both' || view === 'map';
  const showTable = view === 'both' || view === 'table';

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [stops, locationFilter, phoneFilter]);

  useEffect(() => {
    setFreqEdits({});
    setLocationFilter('');
    setPhoneFilter('');
  }, [selectedFlyerId, territoryVersion]);

  useEffect(() => {
    if (selectedStop && !mapPoints.some((p) => p.key === selectedStop)) {
      setSelectedStop(null);
    }
  }, [mapPoints, selectedStop]);

  const totalPages = Math.max(1, Math.ceil(filteredStops.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedStops = filteredStops.slice(pageStart, pageStart + PAGE_SIZE);
  const filteredDoctorCount = filteredStops.reduce((sum, s) => sum + s.doctorCount, 0);
  const pageWindow: number[] = [];
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
    pageWindow.push(i);
  }

  const territoryRadius = territoryResolved?.radiusMiles ?? (Number(territoryForm.radiusMiles) || 30);
  const centroidAddress = territoryResolved?.centerAddress || territoryForm.centerAddress;

  return (
    <div className="rp-page">
      <PageHeader
        eyebrow="Planning"
        title="Route Planner"
        subtitle="Define the coverage territory (centroid + radius), review the doctor locations each active flyer can reach, and set how often each location should be visited. Reps build the actual day route from their GPS when they check in on Smart Route."
        actions={
          !centroidPanelOpen ? (
            <button type="button" onClick={() => setCentroidPanelOpen(true)}>
              {territoryResolved ? 'Edit territory' : 'Set territory'}
            </button>
          ) : null
        }
      />

      {territoryResolved && !centroidPanelOpen ? (
        <div className="rp-territory-summary">
          <div className="rp-territory-summary-item rp-territory-summary-item-grow">
            <span>Coverage centroid</span>
            <strong title={centroidAddress || ''}>{centroidAddress || 'Centroid saved'}</strong>
          </div>
          <div className="rp-territory-summary-item">
            <span>Radius</span>
            <strong>{territoryRadius} miles</strong>
          </div>
          <div className="rp-territory-summary-item">
            <span>Coordinates</span>
            <strong className="cell-mono">
              {territoryResolved.centerLatitude.toFixed(5)}, {territoryResolved.centerLongitude.toFixed(5)}
            </strong>
          </div>
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}

      {centroidPanelOpen ? (
      <div className="rp-territory-card">
        <div className="rp-territory-head">
          <div>
            <h2 className="rp-territory-title">Coverage territory</h2>
            <p className="rp-territory-sub">
              Flyer locations are limited to doctor offices within this radius of the center address.
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={closeCentroidPanel}>
            Close
          </button>
        </div>

        {loadingTerritory ? (
          <p style={{ color: '#64748b', margin: 0 }}>Loading…</p>
        ) : (
          <div className="rp-territory-form">
            <label className="rp-field rp-field-wide">
              Center address
              <AddressAutocomplete
                value={territoryForm.centerAddress}
                onChange={(centerAddress) => setTerritoryForm((f) => ({ ...f, centerAddress }))}
                placeholder="1839 Central Ave, St. Petersburg, FL 33713"
                disabled={savingTerritory}
              />
            </label>
            <label className="rp-field">
              Radius (miles)
              <select
                value={territoryForm.radiusMiles}
                onChange={(e) => setTerritoryForm((f) => ({ ...f, radiusMiles: e.target.value }))}
              >
                {TERRITORY_RADIUS_OPTIONS.map((mi) => (
                  <option key={mi} value={String(mi)}>{mi} miles</option>
                ))}
              </select>
            </label>
            <div className="rp-territory-actions">
              <button type="button" onClick={saveCentroid} disabled={savingTerritory}>
                {savingTerritory ? 'Saving…' : 'Save territory'}
              </button>
            </div>
          </div>
        )}
      </div>
      ) : null}

      <div className="rp-flyers-section">
        <div className="rp-control-label">Active flyers — pick one to see its eligible locations</div>
        {loadingFlyers ? (
          <p style={{ color: '#64748b', margin: 0 }}>Loading flyers…</p>
        ) : flyers.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0 }}>
            No active flyers. Create one in{' '}
            <a href="/campaign-builder">Flyer Builder</a>.
          </p>
        ) : (
          <div className="rp-flyer-tabs" role="tablist" aria-label="Active flyers">
            {flyers.map((f) => {
              const id = String(f.campaignId);
              const active = selectedFlyerId === id;
              return (
                <button
                  key={f.campaignId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`rp-flyer-tab${active ? ' rp-flyer-tab-active' : ''}`}
                  onClick={() => onSelectFlyer(id)}
                >
                  {flyerTabLabel(f)}
                </button>
              );
            })}
          </div>
        )}
        {loadingStops ? (
          <span className="rp-loading-pill" style={{ marginTop: 12 }} aria-live="polite">
            Loading locations…
          </span>
        ) : null}
      </div>

      {selectedFlyer ? (
        <div className="rp-flyer-context">
          <strong>{flyerTabLabel(selectedFlyer)}</strong>
          <span style={{ color: '#94a3b8' }}> · ID {selectedFlyer.campaignId}</span>
          <div style={{ marginTop: 6 }}>
            <strong>Specialty rules:</strong> {specialtySummary(selectedFlyer)}
          </div>
        </div>
      ) : null}

      {loadingStops && !meta ? (
        <div className="card rp-results-loading">Loading locations…</div>
      ) : null}

      {meta ? (
        <>
          <div className="rp-stat-row">
            <span className="rp-stat-chip rp-stat-chip-locations">
              {hasActiveFilters
                ? `${filteredStops.length} of ${stops.length} location${stops.length === 1 ? '' : 's'}`
                : `${stops.length} location${stops.length === 1 ? '' : 's'}`}
            </span>
            <span className="rp-stat-chip rp-stat-chip-doctors">
              {hasActiveFilters
                ? `${filteredDoctorCount} of ${meta.doctorCount} doctor${meta.doctorCount === 1 ? '' : 's'}`
                : `${meta.doctorCount} doctor${meta.doctorCount === 1 ? '' : 's'}`}
            </span>
            <span className="rp-stat-chip rp-stat-chip-territory">
              within {mapRadiusMiles} mi of centroid
            </span>
            {meta.coverage ? (
              <span className="rp-stat-chip rp-stat-chip-due">
                Due: {meta.coverage.dueLocations} / {meta.coverage.totalLocations}
              </span>
            ) : null}
            <span className="rp-view-toggle">
              {(['both', 'map', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={view === v ? 'rp-view-active' : undefined}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </span>
          </div>

          <div className={`rp-results ${view === 'both' ? 'rp-results-both' : 'rp-results-single'}`}>
            <div className={`rp-pane-map${showMap ? '' : ' rp-pane-hidden'}`} aria-hidden={!showMap}>
              <div className="rp-map-wrap rp-map-tall">
                <RoutePlannerCoverageMap
                  points={mapPoints}
                  center={mapCenter}
                  radiusMiles={mapRadiusMiles}
                  selectedKey={selectedStop}
                  visible={showMap}
                />
              </div>
            </div>

            <div className={`rp-pane-table${showTable ? '' : ' rp-pane-hidden'}`} aria-hidden={!showTable}>
                <div className="rp-table-card">
                  <table className="rp-table">
                    <thead>
                      <tr>
                        <th style={{ width: 48 }}>#</th>
                        <th>Location</th>
                        <th>Phone</th>
                        <th style={{ width: 70 }}>Doctors</th>
                        <th style={{ width: 130 }}>Visit every (days)</th>
                        <th style={{ width: 110 }}>Last visit</th>
                        <th style={{ width: 110 }}>Next visit</th>
                        <th style={{ width: 140 }}>Actions</th>
                      </tr>
                      <tr className="rp-table-filter-row">
                        <th />
                        <th>
                          <input
                            type="search"
                            className="rp-filter-input"
                            placeholder="Search name, address, city…"
                            value={locationFilter}
                            onChange={(e) => setLocationFilter(e.target.value)}
                            aria-label="Filter by location"
                          />
                        </th>
                        <th>
                          <input
                            type="search"
                            className="rp-filter-input"
                            placeholder="Search phone…"
                            value={phoneFilter}
                            onChange={(e) => setPhoneFilter(e.target.value)}
                            aria-label="Filter by phone"
                          />
                        </th>
                        <th colSpan={4} />
                        <th>
                          {hasActiveFilters ? (
                            <button
                              type="button"
                              className="btn-secondary rp-filter-clear"
                              onClick={() => {
                                setLocationFilter('');
                                setPhoneFilter('');
                              }}
                            >
                              Clear
                            </button>
                          ) : null}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedStops.map((stop, index) => {
                        const open = expandedStop === stop.locationKey;
                        const hasCoords = stop.latitude != null && stop.longitude != null;
                        const isSelected = selectedStop === stop.locationKey;
                        const saving = savingFreqKey === stop.locationKey;
                        const rowClasses = [
                          open ? 'rp-row-open' : '',
                          isSelected ? 'rp-row-selected' : '',
                          hasCoords ? 'rp-row-clickable' : '',
                        ].filter(Boolean).join(' ');
                        return (
                          <Fragment key={stop.locationKey}>
                            <tr
                              className={rowClasses || undefined}
                              onClick={() => focusStopOnMap(stop.locationKey, hasCoords)}
                              title={hasCoords ? 'Show on map' : 'No map location available'}
                            >
                              <td>
                                <span className="rp-rownum">{pageStart + index + 1}</span>
                              </td>
                              <td>
                                <div className="rp-loc-name">{stop.stopLabel}</div>
                                <div className="rp-loc-addr">{formatAddress(stop)}</div>
                              </td>
                              <td>
                                {stop.phone ? (
                                  <a
                                    href={`tel:${stop.phone}`}
                                    className="rp-phone"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {stop.phone}
                                  </a>
                                ) : (
                                  <span style={{ color: '#94a3b8' }}>—</span>
                                )}
                              </td>
                              <td>
                                <span className="rp-doc-count">{stop.doctorCount}</span>
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <div className="rp-freq-cell">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    className="rp-freq-input"
                                    value={freqInputValue(stop.locationKey, stop.visitFrequencyDays)}
                                    disabled={saving}
                                    onChange={(e) => changeStopFrequency(stop.locationKey, e.target.value)}
                                  />
                                </div>
                              </td>
                              <td>
                                <span className="rp-visit-date">{stop.lastVisitDate || '—'}</span>
                              </td>
                              <td>
                                {stop.nextVisitDate ? (
                                  <span className={`rp-visit-date${stop.isDue ? ' rp-visit-due' : ''}`}>
                                    {stop.nextVisitDate}
                                  </span>
                                ) : (
                                  <span className="rp-visit-date rp-visit-due">Due now</span>
                                )}
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="rp-save-btn"
                                    disabled={saving}
                                    onClick={() =>
                                      saveStopFrequency(
                                        stop.locationKey,
                                        freqInputValue(stop.locationKey, stop.visitFrequencyDays),
                                      )
                                    }
                                  >
                                    {saving ? '…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className={`rp-details-btn${open ? ' rp-details-btn-open' : ''}`}
                                    onClick={() => setExpandedStop(open ? null : stop.locationKey)}
                                  >
                                    {open ? 'Hide' : 'Details'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {open ? (
                              <tr key={`${stop.locationKey}-detail`}>
                                <td colSpan={8} className="rp-detail-cell">
                                  <div className="rp-detail-head">
                                    {stop.doctorCount} doctor{stop.doctorCount === 1 ? '' : 's'} at this location
                                  </div>
                                  <div className="rp-doc-grid">
                                    {stop.doctors.map((d) => (
                                      <div key={d.doctorId} className="rp-doc-card">
                                        <span className="rp-doc-name">{d.doctorName}</span>
                                        {d.matchedSpecialityCode ? (
                                          <span className="rp-spec-badge">{d.matchedSpecialityCode}</span>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                      {filteredStops.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ color: '#64748b' }}>
                            {stops.length === 0
                              ? 'No locations in this territory for this flyer.'
                              : 'No locations match your search. Try a different location or phone.'}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>

                  {filteredStops.length > 0 ? (
                    <div className="rp-pagination">
                      <span className="rp-page-info">
                        Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredStops.length)} of{' '}
                        {filteredStops.length}
                        {hasActiveFilters ? ` (${stops.length} total)` : ''}
                      </span>
                      <div className="rp-page-controls">
                        <button
                          type="button"
                          className="rp-page-btn"
                          onClick={() => setPage(currentPage - 1)}
                          disabled={currentPage === 1}
                        >
                          ‹ Prev
                        </button>
                        {pageWindow[0] > 1 ? (
                          <>
                            <button type="button" className="rp-page-btn" onClick={() => setPage(1)}>1</button>
                            {pageWindow[0] > 2 ? <span className="rp-page-ellipsis">…</span> : null}
                          </>
                        ) : null}
                        {pageWindow.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`rp-page-btn${p === currentPage ? ' rp-page-btn-active' : ''}`}
                            onClick={() => setPage(p)}
                          >
                            {p}
                          </button>
                        ))}
                        {pageWindow[pageWindow.length - 1] < totalPages ? (
                          <>
                            {pageWindow[pageWindow.length - 1] < totalPages - 1 ? (
                              <span className="rp-page-ellipsis">…</span>
                            ) : null}
                            <button type="button" className="rp-page-btn" onClick={() => setPage(totalPages)}>
                              {totalPages}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="rp-page-btn"
                          onClick={() => setPage(currentPage + 1)}
                          disabled={currentPage === totalPages}
                        >
                          Next ›
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
