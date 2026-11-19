'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../src/services/api';
import { Campaign, CampaignConfig, emptyConfigForm } from '../../../src/types/campaign';

type PreviewTarget = {
  targetType: string;
  targetName: string;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  npiNumber?: string | null;
  specialty?: string | null;
  taxonomyCode?: string | null;
  taxonomyDescription?: string | null;
  phone?: string | null;
  fax?: string | null;
  distanceMiles?: number | null;
  flyer?: string | null;
};

function configIdOf(config: CampaignConfig) {
  return Number(config.ConfigId || config.CampaignConfigId || 0);
}

export default function CampaignDetailPage() {
  const params = useParams();
  const campaignId = Number(params.id);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [configs, setConfigs] = useState<CampaignConfig[]>([]);
  const [form, setForm] = useState(emptyConfigForm);
  const [previewConfigId, setPreviewConfigId] = useState<number | null>(null);
  const [previewTargets, setPreviewTargets] = useState<PreviewTarget[]>([]);
  const [previewCount, setPreviewCount] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!Number.isFinite(campaignId)) return;
    const [campaignRes, configsRes] = await Promise.all([
      api.get(`/campaigns/${campaignId}`),
      api.get('/client-workflow/campaign-configs', { params: { campaignId } }),
    ]);
    setCampaign(campaignRes.data);
    setConfigs(configsRes.data);
  }

  useEffect(() => {
    load().catch(() => setError('Could not load campaign details.'));
  }, [campaignId]);

  function resetForm() {
    setForm(emptyConfigForm);
    setMessage('');
    setError('');
  }

  const doctorFiltersEnabled = String(form.targetType).toLowerCase() !== 'pharmacy';

  function buildPayload() {
    return {
      campaignId,
      configName: form.configName,
      targetType: form.targetType,
      doctorType: doctorFiltersEnabled ? form.doctorType : null,
      specialtySource: doctorFiltersEnabled ? form.specialtySource : null,
      specialty: doctorFiltersEnabled ? (form.specialty || null) : null,
      customSpecialty: doctorFiltersEnabled ? (form.customSpecialty || null) : null,
      taxonomyCode: doctorFiltersEnabled ? (form.taxonomyCode || null) : null,
      taxonomyDescription: doctorFiltersEnabled ? (form.taxonomyDescription || null) : null,
      requirePrimaryTaxonomy: doctorFiltersEnabled ? form.requirePrimaryTaxonomy : false,
      geography: form.geography || null,
      city: form.city || null,
      state: form.state || 'FL',
      market: form.market || null,
      centerLatitude: form.centerLatitude ? Number(form.centerLatitude) : null,
      centerLongitude: form.centerLongitude ? Number(form.centerLongitude) : null,
      radiusMiles: form.radiusMiles ? Number(form.radiusMiles) : null,
      visitFrequencyDays: form.visitFrequencyDays ? Number(form.visitFrequencyDays) : null,
      checkInRequired: form.checkInRequired,
      proofRequired: form.proofRequired,
    };
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      await api.post('/client-workflow/campaign-configs', buildPayload());
      setMessage('Config created.');
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save config.');
    }
  }

  async function previewConfig(configId: number) {
    try {
      setError('');
      setMessage('');
      const res = await api.get(`/client-workflow/campaign-configs/${configId}/preview`);
      setPreviewConfigId(configId);
      setPreviewTargets(res.data?.targets || []);
      setPreviewCount(Number(res.data?.count || 0));
      setMessage(`Preview found ${res.data?.count || 0} matching targets.`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not preview this config.');
    }
  }

  async function createSuggestions(configId: number) {
    if (previewConfigId !== configId) {
      setError('Preview this config first before creating suggestions.');
      return;
    }
    if (!window.confirm(`Create suggestions for ${previewCount} previewed targets?`)) return;
    try {
      const res = await api.post(`/client-workflow/campaign-configs/${configId}/suggestions`, {
        previewConfirmed: true,
        limit: 500,
      });
      setMessage(`Created ${res.data?.createdCount || 0} suggestion(s).`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create suggestions.');
    }
  }

  if (!Number.isFinite(campaignId)) return <p>Invalid campaign id.</p>;

  return (
    <div>
      <p><Link href="/campaigns">← Back to campaigns</Link></p>
      <h1>{campaign?.CampaignName || `Campaign #${campaignId}`}</h1>
      <h2>Workflow Configs</h2>
      <p>Create a config, preview matches, then confirm suggestions.</p>

      <form className="card config-form" onSubmit={saveConfig}>
        <div className="config-grid">
          <input placeholder="Config name" value={form.configName} onChange={(e) => setForm({ ...form, configName: e.target.value })} required />
          <select value={form.targetType} onChange={(e) => setForm({ ...form, targetType: e.target.value })}>
            <option value="Doctor">Doctor</option>
            <option value="Pharmacy">Pharmacy</option>
            <option value="Both">Both</option>
          </select>
          {doctorFiltersEnabled ? (
            <>
              <select value={form.doctorType} onChange={(e) => setForm({ ...form, doctorType: e.target.value })}>
                <option value="Any">Any</option>
                <option value="Primary Care">Primary Care</option>
                <option value="Specialty">Specialty</option>
              </select>
              <select value={form.specialtySource} onChange={(e) => setForm({ ...form, specialtySource: e.target.value })}>
                <option value="backend">Backend Master_Doctor</option>
                <option value="npi_registry">NPI Registry</option>
              </select>
              <input placeholder="Specialty (optional)" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
              <input placeholder="Custom specialty (optional)" value={form.customSpecialty} onChange={(e) => setForm({ ...form, customSpecialty: e.target.value })} />
              <input placeholder="Taxonomy code (optional)" value={form.taxonomyCode} onChange={(e) => setForm({ ...form, taxonomyCode: e.target.value })} />
              <input placeholder="Taxonomy description (optional)" value={form.taxonomyDescription} onChange={(e) => setForm({ ...form, taxonomyDescription: e.target.value })} />
              <label><input type="checkbox" checked={form.requirePrimaryTaxonomy} onChange={(e) => setForm({ ...form, requirePrimaryTaxonomy: e.target.checked })} /> Require primary taxonomy</label>
            </>
          ) : null}
          <select value={form.geography} onChange={(e) => setForm({ ...form, geography: e.target.value, city: e.target.value })}>
            <option value="Pinellas Park">Pinellas Park</option>
            <option value="St. Petersburg">St. Petersburg</option>
          </select>
          <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <input placeholder="Market (optional)" value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} />
          <input placeholder="Radius miles" value={form.radiusMiles} onChange={(e) => setForm({ ...form, radiusMiles: e.target.value })} />
          <input placeholder="Visit frequency days" value={form.visitFrequencyDays} onChange={(e) => setForm({ ...form, visitFrequencyDays: e.target.value })} />
          <label><input type="checkbox" checked={form.checkInRequired} onChange={(e) => setForm({ ...form, checkInRequired: e.target.checked })} /> Check-in required</label>
          <label><input type="checkbox" checked={form.proofRequired} onChange={(e) => setForm({ ...form, proofRequired: e.target.checked })} /> Proof upload required</label>
        </div>
        <button type="submit">Create config</button>
      </form>

      {message ? <p style={{ color: '#047857' }}>{message}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Config</th>
            <th>Target</th>
            <th>Filters</th>
            <th>Geo</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {configs.map((config) => {
            const cfgId = configIdOf(config);
            return (
              <tr key={cfgId}>
                <td>{config.ConfigName}</td>
                <td>{config.TargetType}</td>
                <td>{config.DoctorType || '—'} · {config.SpecialtySource || '—'} · {config.TaxonomyCode || '—'}</td>
                <td>{config.Geography || config.TargetCity || '—'} · {config.RadiusMiles ? `${config.RadiusMiles} mi` : '—'}</td>
                <td>
                  <button type="button" onClick={() => previewConfig(cfgId)}>Preview</button>
                  {' · '}
                  <button type="button" onClick={() => createSuggestions(cfgId)} disabled={previewConfigId !== cfgId}>Create suggestions</button>
                  {' · '}
                  <Link href={`/workflow?campaignId=${campaignId}`}>Workflow</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {previewConfigId ? (
        <>
          <h3>Preview ({previewCount})</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>NPI</th>
                <th>Specialty / Taxonomy</th>
                <th>Contact</th>
                <th>Address</th>
                <th>Distance</th>
                <th>Flyer</th>
              </tr>
            </thead>
            <tbody>
              {previewTargets.map((target, index) => (
                <tr key={`${target.targetName}-${index}`}>
                  <td>{target.targetName}</td>
                  <td>{target.targetType}</td>
                  <td>{target.npiNumber || '—'}</td>
                  <td>{target.specialty || '—'} · {target.taxonomyCode || '—'} · {target.taxonomyDescription || '—'}</td>
                  <td>{target.phone || '—'} · {target.fax || '—'}</td>
                  <td>{[target.addressStreet, target.addressCity, target.addressState, target.addressZip].filter(Boolean).join(', ') || '—'}</td>
                  <td>{target.distanceMiles != null ? `${target.distanceMiles} mi` : '—'}</td>
                  <td>{target.flyer || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
