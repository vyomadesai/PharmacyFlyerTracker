'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../src/services/api';
import type { CampaignConfig } from '../../../../src/types/campaign';
import type { Market } from '../../../../src/types/location';
import type { CampaignTarget, DoctorSearchResponse, TargetedDoctor } from '../../../../src/types/targeting';

const emptyFilters = {
  npi: '',
  name: '',
  specialty: '',
  customSpecialty: '',
  doctorType: 'any',
  taxonomyCode: '',
  requirePrimaryTaxonomy: false,
  city: '',
  state: '',
  zip: '',
  marketId: '',
  centerLatitude: '',
  centerLongitude: '',
  radiusMiles: '',
  hasPhone: false,
  hasFax: false,
};

export default function FindDoctorsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const campaignId = Number(params.id);
  const initialConfigId = searchParams.get('configId') || '';

  const [configs, setConfigs] = useState<CampaignConfig[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState(initialConfigId);
  const [filters, setFilters] = useState(emptyFilters);
  const [results, setResults] = useState<DoctorSearchResponse | null>(null);
  const [savedTargets, setSavedTargets] = useState<CampaignTarget[]>([]);
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedConfig = useMemo(
    () => configs.find((c) => String(c.CampaignConfigId) === selectedConfigId) || null,
    [configs, selectedConfigId]
  );

  async function loadMeta() {
    const [configsRes, marketsRes] = await Promise.all([
      api.get('/campaign-configs', { params: { campaignId } }),
      api.get('/markets'),
    ]);
    setConfigs(configsRes.data);
    setMarkets(marketsRes.data);
  }

  async function loadSavedTargets(configId: string) {
    if (!configId) {
      setSavedTargets([]);
      return;
    }
    const res = await api.get('/campaign-targets', {
      params: {
        campaignId,
        campaignConfigId: configId,
        targetType: 'doctor',
      },
    });
    setSavedTargets(res.data.targets || res.data);
  }

  useEffect(() => {
    if (!Number.isFinite(campaignId)) return;
    loadMeta().catch(() => setError('Could not load campaign configs.'));
  }, [campaignId]);

  useEffect(() => {
    loadSavedTargets(selectedConfigId).catch(() => undefined);
  }, [selectedConfigId, campaignId]);

  function applyConfigDefaults(config: CampaignConfig) {
    setFilters({
      ...emptyFilters,
      specialty: config.SpecialtySource === 'backend' ? (config.SpecialtyValue || '') : '',
      customSpecialty: config.CustomSpecialtyText || '',
      doctorType: config.DoctorType || 'any',
      taxonomyCode: config.TaxonomyCode || '',
      requirePrimaryTaxonomy: Boolean(config.RequirePrimaryTaxonomy),
      marketId: config.MarketId != null ? String(config.MarketId) : '',
      centerLatitude: config.CenterLatitude != null ? String(config.CenterLatitude) : '',
      centerLongitude: config.CenterLongitude != null ? String(config.CenterLongitude) : '',
      radiusMiles: config.RadiusMiles != null ? String(config.RadiusMiles) : '',
    });
  }

  function onConfigChange(configId: string) {
    setSelectedConfigId(configId);
    setResults(null);
    setSelectedDoctorIds([]);
    const config = configs.find((c) => String(c.CampaignConfigId) === configId);
    if (config) applyConfigDefaults(config);
  }

  async function searchDoctors() {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const res = await api.get('/targeting/doctors', {
        params: {
          campaignConfigId: selectedConfigId || undefined,
          npi: filters.npi || undefined,
          name: filters.name || undefined,
          specialty: filters.specialty || undefined,
          customSpecialty: filters.customSpecialty || undefined,
          doctorType: filters.doctorType !== 'any' ? filters.doctorType : undefined,
          taxonomyCode: filters.taxonomyCode || undefined,
          requirePrimaryTaxonomy: filters.requirePrimaryTaxonomy ? 'true' : undefined,
          city: filters.city || undefined,
          state: filters.state || undefined,
          zip: filters.zip || undefined,
          marketId: filters.marketId || undefined,
          centerLatitude: filters.centerLatitude || undefined,
          centerLongitude: filters.centerLongitude || undefined,
          radiusMiles: filters.radiusMiles || undefined,
          hasPhone: filters.hasPhone ? 'true' : undefined,
          hasFax: filters.hasFax ? 'true' : undefined,
        },
      });
      setResults(res.data);
      setSelectedDoctorIds([]);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Doctor search failed.');
    } finally {
      setLoading(false);
    }
  }

  function toggleDoctor(doctorId: number) {
    setSelectedDoctorIds((current) =>
      current.includes(doctorId) ? current.filter((id) => id !== doctorId) : [...current, doctorId]
    );
  }

  function toggleAll() {
    if (!results?.doctors.length) return;
    if (selectedDoctorIds.length === results.doctors.length) {
      setSelectedDoctorIds([]);
    } else {
      setSelectedDoctorIds(results.doctors.map((d) => d.DoctorId));
    }
  }

  async function saveSelected() {
    if (!selectedConfigId) {
      setError('Select a campaign config first.');
      return;
    }
    if (!selectedDoctorIds.length) {
      setError('Select at least one doctor.');
      return;
    }

    try {
      const res = await api.post('/campaign-targets/doctors', {
        campaignId,
        campaignConfigId: Number(selectedConfigId),
        doctorIds: selectedDoctorIds,
      });
      setMessage(`Saved ${res.data.savedCount} suggested target(s).`);
      setSelectedDoctorIds([]);
      loadSavedTargets(selectedConfigId);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save selected doctors.');
    }
  }

  if (!Number.isFinite(campaignId)) return <p>Invalid campaign id.</p>;

  return (
    <div>
      <p><Link href={`/campaigns/${campaignId}`}>← Back to campaign configs</Link></p>
      <h1>Find Doctors</h1>
      <p>Search existing Master_Doctor records grouped by NPI. Selected doctors are saved as suggested campaign targets referencing Master_Doctor.ID.</p>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <label>
          Campaign config
          <select value={selectedConfigId} onChange={(e) => onConfigChange(e.target.value)}>
            <option value="">Select config</option>
            {configs.map((config) => (
              <option key={config.CampaignConfigId} value={config.CampaignConfigId}>
                {config.ConfigName} ({config.TargetType})
              </option>
            ))}
          </select>
        </label>
        {selectedConfig ? (
          <p style={{ margin: 0, color: '#475569' }}>
            Config: {selectedConfig.ConfigName} · Flyer: {selectedConfig.FlyerName || selectedConfig.FlyerIdentifier || '—'}
          </p>
        ) : null}
      </div>

      <div className="card config-grid">
        <input placeholder="NPI" value={filters.npi} onChange={(e) => setFilters({ ...filters, npi: e.target.value })} />
        <input placeholder="Doctor name" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} />
        <input placeholder="Specialty" value={filters.specialty} onChange={(e) => setFilters({ ...filters, specialty: e.target.value })} />
        <input placeholder="Custom specialty" value={filters.customSpecialty} onChange={(e) => setFilters({ ...filters, customSpecialty: e.target.value })} />
        <select value={filters.doctorType} onChange={(e) => setFilters({ ...filters, doctorType: e.target.value })}>
          <option value="any">Any doctor type</option>
          <option value="primary_care">Primary Care</option>
          <option value="specialist">Specialist</option>
        </select>
        <input placeholder="Taxonomy code (207R00000X)" value={filters.taxonomyCode} onChange={(e) => setFilters({ ...filters, taxonomyCode: e.target.value })} />
        <input placeholder="City" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} />
        <input placeholder="State" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} />
        <input placeholder="Zip" value={filters.zip} onChange={(e) => setFilters({ ...filters, zip: e.target.value })} />
        <select value={filters.marketId} onChange={(e) => setFilters({ ...filters, marketId: e.target.value })}>
          <option value="">No market</option>
          {markets.map((market) => (
            <option key={market.MarketId} value={market.MarketId}>{market.MarketName}</option>
          ))}
        </select>
        <input placeholder="Center latitude" value={filters.centerLatitude} onChange={(e) => setFilters({ ...filters, centerLatitude: e.target.value })} />
        <input placeholder="Center longitude" value={filters.centerLongitude} onChange={(e) => setFilters({ ...filters, centerLongitude: e.target.value })} />
        <input placeholder="Radius miles" value={filters.radiusMiles} onChange={(e) => setFilters({ ...filters, radiusMiles: e.target.value })} />
        <label className="checkbox-label"><input type="checkbox" checked={filters.requirePrimaryTaxonomy} onChange={(e) => setFilters({ ...filters, requirePrimaryTaxonomy: e.target.checked })} /> Primary taxonomy saved</label>
        <label className="checkbox-label"><input type="checkbox" checked={filters.hasPhone} onChange={(e) => setFilters({ ...filters, hasPhone: e.target.checked })} /> Has phone</label>
        <label className="checkbox-label"><input type="checkbox" checked={filters.hasFax} onChange={(e) => setFilters({ ...filters, hasFax: e.target.checked })} /> Has fax</label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <button type="button" onClick={searchDoctors} disabled={loading}>{loading ? 'Searching...' : 'Search Doctors'}</button>
          <button type="button" onClick={saveSelected} disabled={!selectedDoctorIds.length}>Save Selected ({selectedDoctorIds.length})</button>
        </div>
      </div>

      {message ? <p style={{ color: '#047857' }}>{message}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {results?.warnings?.length ? (
        <div className="card map-error">{results.warnings.join(' ')}</div>
      ) : null}

      {results ? (
        <div className="card">
          <strong>{results.count} doctor group(s) found</strong>
          <button type="button" onClick={toggleAll} style={{ marginLeft: 12 }}>Toggle all</button>
        </div>
      ) : null}

      {results?.doctors.length ? (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Doctor</th>
              <th>NPI / Group</th>
              <th>Specialty / Type</th>
              <th>Taxonomy</th>
              <th>Address / Practice</th>
              <th>Phone / Fax / License</th>
              <th>Coords / Distance</th>
            </tr>
          </thead>
          <tbody>
            {results.doctors.map((doctor: TargetedDoctor) => (
              <tr key={doctor.DoctorId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedDoctorIds.includes(doctor.DoctorId)}
                    onChange={() => toggleDoctor(doctor.DoctorId)}
                  />
                </td>
                <td>
                  {doctor.DoctorName}<br />
                  <small>DoctorId {doctor.DoctorId}</small>
                </td>
                <td>
                  {doctor.NPI || '—'}<br />
                  <small>{doctor.LocalRecordCount > 1 ? `${doctor.LocalRecordCount} local records` : '1 local record'}</small>
                </td>
                <td>
                  {doctor.Specialty || '—'}<br />
                  <small>{doctor.DoctorType}</small>
                </td>
                <td>
                  {doctor.TaxonomyCode || '—'}<br />
                  <small>{doctor.TaxonomyDescription || '—'}{doctor.PrimaryTaxonomy ? ' · primary' : ''}</small>
                </td>
                <td>
                  {doctor.PrimaryAddress || '—'}<br />
                  <small>{doctor.SecondaryAddress || ''}</small><br />
                  <small>{[doctor.City, doctor.State, doctor.Zip].filter(Boolean).join(', ')}</small><br />
                  <small>{doctor.PracticeName || '—'}</small>
                </td>
                <td>
                  {doctor.Phone || '—'}<br />
                  <small>Fax: {doctor.Fax || '—'}</small><br />
                  <small>LIC: {doctor.LicenseNumber || '—'}</small>
                </td>
                <td>
                  {doctor.Latitude != null && doctor.Longitude != null
                    ? `${doctor.Latitude}, ${doctor.Longitude}`
                    : <span style={{ color: '#b45309' }}>Missing coordinates</span>}
                  <br />
                  <small>{doctor.CoordinateSource || 'no geocode'}</small><br />
                  <small>{doctor.DistanceMiles != null ? `${doctor.DistanceMiles} mi` : '—'}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {savedTargets.length ? (
        <>
          <h2>Saved Suggested Targets</h2>
          <table>
            <thead>
              <tr><th>Target ID</th><th>DoctorId</th><th>NPI</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {savedTargets.map((target) => (
                <tr key={target.CampaignTargetId}>
                  <td>{target.CampaignTargetId}</td>
                  <td>{target.DoctorId}</td>
                  <td>{target.NPI || '—'}</td>
                  <td>{target.ApprovalStatus || target.TargetStatus}</td>
                  <td>{target.CreatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
