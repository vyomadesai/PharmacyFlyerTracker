'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../src/services/api';
import type { Campaign } from '../../src/types/campaign';
import type { CampaignConfig } from '../../src/types/campaign';
import type { ApprovalStatus, CampaignTarget } from '../../src/types/targeting';

const TABS: ApprovalStatus[] = ['suggested', 'approved', 'rejected', 'assigned', 'completed'];
const VISIT_DUE_FILTERS = [
  { value: '', label: 'All visit schedules' },
  { value: 'due_now', label: 'Due now' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'visited_recently', label: 'Visited recently (14d)' },
];

export default function ApprovalQueuePage() {
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get('campaignId') || '';
  const initialConfigId = searchParams.get('configId') || '';

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [configs, setConfigs] = useState<CampaignConfig[]>([]);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [activeTab, setActiveTab] = useState<ApprovalStatus>('suggested');
  const [campaignId, setCampaignId] = useState(initialCampaignId);
  const [configId, setConfigId] = useState(initialConfigId);
  const [visitDueFilter, setVisitDueFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredConfigs = useMemo(
    () => configs.filter((c) => !campaignId || String(c.CampaignId) === campaignId),
    [configs, campaignId],
  );

  async function loadMeta() {
    const [campaignRes, configRes] = await Promise.all([
      api.get('/campaigns'),
      api.get('/campaign-configs'),
    ]);
    setCampaigns(campaignRes.data);
    setConfigs(configRes.data);
  }

  async function loadTargets() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/campaign-targets', {
        params: {
          approvalStatus: activeTab,
          campaignId: campaignId || undefined,
          campaignConfigId: configId || undefined,
          visitDueFilter: visitDueFilter || undefined,
        },
      });
      setTargets(res.data.targets || []);
      setSelectedIds([]);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not load approval queue.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeta().catch(() => setError('Could not load campaigns/configs.'));
  }, []);

  useEffect(() => {
    loadTargets();
  }, [activeTab, campaignId, configId, visitDueFilter]);

  function toggleSelected(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function toggleAll() {
    if (selectedIds.length === targets.length) setSelectedIds([]);
    else setSelectedIds(targets.map((t) => t.CampaignTargetId));
  }

  async function generateSuggested() {
    if (!configId) {
      setError('Select a campaign config to generate suggested targets.');
      return;
    }
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const res = await api.post('/campaign-targets/generate', { campaignConfigId: Number(configId) });
      setMessage(`Generated ${res.data.createdCount} suggested target(s). Skipped doctors: ${res.data.skipped?.doctors || 0}, pharmacies: ${res.data.skipped?.pharmacies || 0}.`);
      setActiveTab('suggested');
      await loadTargets();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not generate suggested targets.');
    } finally {
      setLoading(false);
    }
  }

  async function approveOne(targetId: number) {
    setError('');
    try {
      await api.post(`/campaign-targets/${targetId}/approve`, { notes: notes || undefined });
      setMessage(`Approved target #${targetId}.`);
      await loadTargets();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Approve failed.');
    }
  }

  async function rejectOne(targetId: number) {
    setError('');
    try {
      await api.post(`/campaign-targets/${targetId}/reject`, { notes: notes || undefined });
      setMessage(`Rejected target #${targetId}.`);
      await loadTargets();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Reject failed.');
    }
  }

  async function bulkApprove() {
    if (!selectedIds.length) return;
    setError('');
    try {
      const res = await api.post('/campaign-targets/bulk-approve', { targetIds: selectedIds, notes: notes || undefined });
      setMessage(`Approved ${res.data.updatedCount} target(s).`);
      await loadTargets();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Bulk approve failed.');
    }
  }

  async function bulkReject() {
    if (!selectedIds.length) return;
    setError('');
    try {
      const res = await api.post('/campaign-targets/bulk-reject', { targetIds: selectedIds, notes: notes || undefined });
      setMessage(`Rejected ${res.data.updatedCount} target(s).`);
      await loadTargets();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Bulk reject failed.');
    }
  }

  async function saveNotes(targetId: number, value: string) {
    try {
      await api.patch(`/campaign-targets/${targetId}/notes`, { notes: value });
      setMessage('Notes saved.');
      await loadTargets();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save notes.');
    }
  }

  return (
    <div>
      <h1>Approval Queue</h1>
      <p>
        Review suggested doctor/pharmacy targets and approve which flyer is assigned before routing.
        Only <strong>approved</strong> or <strong>assigned</strong> targets are available for route assignment.
      </p>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setConfigId(''); }}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.CampaignId} value={c.CampaignId}>{c.CampaignName}</option>
            ))}
          </select>
          <select value={configId} onChange={(e) => setConfigId(e.target.value)}>
            <option value="">All configs</option>
            {filteredConfigs.map((c) => (
              <option key={c.CampaignConfigId} value={c.CampaignConfigId}>
                {c.ConfigName} · {c.FlyerName || 'No flyer name'} ({c.TargetType})
              </option>
            ))}
          </select>
          <button type="button" onClick={generateSuggested} disabled={loading || !configId}>
            Generate suggested from config
          </button>
          <Link href="/campaigns">Manage campaign configs</Link>
          <select value={visitDueFilter} onChange={(e) => setVisitDueFilter(e.target.value)}>
            {VISIT_DUE_FILTERS.map((f) => (
              <option key={f.value || 'all'} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <label>
          Approval notes (applied to approve/reject actions)
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for approver" />
        </label>
      </div>

      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'tab-active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>{targets.length} target(s)</span>
      </div>

      {(activeTab === 'suggested' || activeTab === 'approved') && targets.length ? (
        <div className="card" style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={toggleAll}>Toggle all</button>
          {activeTab === 'suggested' ? (
            <>
              <button type="button" onClick={bulkApprove} disabled={!selectedIds.length}>Bulk approve ({selectedIds.length})</button>
              <button type="button" onClick={bulkReject} disabled={!selectedIds.length}>Bulk reject ({selectedIds.length})</button>
            </>
          ) : null}
        </div>
      ) : null}

      {message ? <p style={{ color: '#047857' }}>{message}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {loading ? <p>Loading...</p> : null}

      {targets.length ? (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Target</th>
              <th>Flyer / Campaign</th>
              <th>Specialty / Taxonomy</th>
              <th>Address / Contact</th>
              <th>Visit rules</th>
              <th>Notes / Actions</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((target) => (
              <tr key={target.CampaignTargetId}>
                <td>
                  {(activeTab === 'suggested' || activeTab === 'approved') ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(target.CampaignTargetId)}
                      onChange={() => toggleSelected(target.CampaignTargetId)}
                    />
                  ) : null}
                </td>
                <td>
                  <strong>{target.TargetName || '—'}</strong><br />
                  <small>{target.TargetType}{target.TargetType === 'doctor' && target.NPI ? ` · NPI ${target.NPI}` : ''}{target.TargetType === 'pharmacy' && target.PharmacyId ? ` · PharmacyId ${target.PharmacyId}` : ''}</small><br />
                  <small>{target.DoctorType || '—'} · {target.MarketName || 'No market'}</small><br />
                  <small>
                    {target.Latitude != null && target.Longitude != null
                      ? `${target.Latitude}, ${target.Longitude}`
                      : <span style={{ color: '#b45309' }}>Missing coordinates</span>}
                    {target.DistanceMiles != null ? ` · ${target.DistanceMiles} mi` : ''}
                  </small>
                </td>
                <td>
                  {target.AssignedFlyerName || target.ConfigFlyerName || '—'}<br />
                  <small>{target.CampaignName || '—'}</small><br />
                  <small>{target.ConfigName || '—'}</small>
                </td>
                <td>
                  {target.Specialty || '—'}<br />
                  <small>{target.TaxonomyCode || '—'}</small><br />
                  <small>{target.TaxonomyDescription || '—'}</small><br />
                  <small>{target.PracticeName || ''}</small>
                </td>
                <td>
                  {target.PrimaryAddress || '—'}<br />
                  <small>{target.SecondaryAddress || ''}</small><br />
                  <small>{[target.City, target.State, target.Zip].filter(Boolean).join(', ')}</small><br />
                  <small>Phone: {target.Phone || '—'} · Fax: {target.Fax || '—'}</small><br />
                  <small>LIC: {target.LicenseNumber || '—'}</small>
                </td>
                <td>
                  {target.VisitFrequencyType}{target.VisitFrequencyDays ? ` (${target.VisitFrequencyDays}d)` : ''}<br />
                  <small>Last visited: {target.LastVisitedAt ? String(target.LastVisitedAt).slice(0, 10) : '—'}</small><br />
                  <small>Next due: {target.NextDueDate || '—'}</small><br />
                  <small>Status: {target.VisitDueStatus || '—'}</small><br />
                  <small>Check-in: {target.CheckInRequired ? 'yes' : 'no'} · Proof: {target.ProofUploadRequired ? 'yes' : 'no'}</small>
                </td>
                <td>
                  <textarea
                    defaultValue={target.ApprovalNotes || ''}
                    rows={2}
                    style={{ width: '100%', minWidth: 180 }}
                    onBlur={(e) => {
                      if ((target.ApprovalNotes || '') !== e.target.value) {
                        saveNotes(target.CampaignTargetId, e.target.value);
                      }
                    }}
                  />
                  {activeTab === 'suggested' ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button type="button" onClick={() => approveOne(target.CampaignTargetId)}>Approve</button>
                      <button type="button" onClick={() => rejectOne(target.CampaignTargetId)}>Reject</button>
                    </div>
                  ) : null}
                  <small style={{ display: 'block', marginTop: 6 }}>{target.ApprovalStatus}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !loading ? (
        <div className="card"><p>No targets in this tab. Generate suggested targets from a campaign config or use Find Doctors on a campaign.</p></div>
      ) : null}
    </div>
  );
}
