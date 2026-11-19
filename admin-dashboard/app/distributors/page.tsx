'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../src/services/api';
import type { Campaign } from '../../src/types/campaign';

type Distributor = {
  userId: number;
  userCode: string | null;
  fullName: string;
  email: string | null;
  employmentType: string | null;
  homeAddress: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  defaultDailyFlyerCapacity: number;
  isActive: boolean;
  assignedToday: number;
  deliveredToday: number;
  remainingToday: number;
};

type AssignableTarget = {
  CampaignTargetId: number;
  TargetName?: string | null;
  AssignedFlyerName?: string | null;
  PrimaryAddress?: string | null;
  City?: string | null;
};

const emptyProfileForm = {
  employmentType: 'full_time',
  homeAddress: '',
  homeLatitude: '',
  homeLongitude: '',
  defaultDailyFlyerCapacity: '25',
  isActive: true,
};

const emptyAssignForm = {
  distributorUserId: '',
  campaignId: '',
  flyerName: '',
  assignedQuantity: '25',
  force: false,
};

export default function DistributorsPage() {
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assignableTargets, setAssignableTargets] = useState<AssignableTarget[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<number[]>([]);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>>>([]);
  const [capacityWarning, setCapacityWarning] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadDistributors() {
    const res = await api.get('/distributors', { params: { includeInactive: 'true' } });
    setDistributors(res.data);
  }

  async function loadMeta() {
    const [_, campaignRes] = await Promise.all([
      loadDistributors(),
      api.get('/campaigns'),
    ]);
    setCampaigns(campaignRes.data);
  }

  useEffect(() => { loadMeta().catch(() => setError('Could not load distributors.')); }, []);

  const selectedDistributor = useMemo(
    () => distributors.find((d) => String(d.userId) === assignForm.distributorUserId) || null,
    [distributors, assignForm.distributorUserId],
  );

  async function searchUsers() {
    if (userSearch.trim().length < 2) return;
    const res = await api.get('/distributors/search-users', { params: { q: userSearch } });
    setSearchResults(res.data);
  }

  function startEdit(distributor: Distributor) {
    setEditingUserId(distributor.userId);
    setProfileForm({
      employmentType: distributor.employmentType || 'full_time',
      homeAddress: distributor.homeAddress || '',
      homeLatitude: distributor.homeLatitude != null ? String(distributor.homeLatitude) : '',
      homeLongitude: distributor.homeLongitude != null ? String(distributor.homeLongitude) : '',
      defaultDailyFlyerCapacity: String(distributor.defaultDailyFlyerCapacity ?? 25),
      isActive: distributor.isActive,
    });
    setAssignForm((current) => ({ ...current, distributorUserId: String(distributor.userId) }));
    setMessage('');
    setError('');
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUserId) return;
    setMessage('');
    setError('');
    try {
      await api.put(`/distributors/${editingUserId}`, {
        role: 'distributor',
        employmentType: profileForm.employmentType,
        homeAddress: profileForm.homeAddress || null,
        homeLatitude: profileForm.homeLatitude ? Number(profileForm.homeLatitude) : null,
        homeLongitude: profileForm.homeLongitude ? Number(profileForm.homeLongitude) : null,
        defaultDailyFlyerCapacity: Number(profileForm.defaultDailyFlyerCapacity || 25),
        isActive: profileForm.isActive,
      });
      setMessage('Distributor profile saved.');
      await loadDistributors();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save profile.');
    }
  }

  async function markUserAsDistributor(userId: number) {
    setError('');
    try {
      await api.post(`/distributors/${userId}/mark-distributor`, {
        employmentType: 'full_time',
        defaultDailyFlyerCapacity: 25,
      });
      setMessage(`User ${userId} marked as distributor.`);
      setSearchResults([]);
      setUserSearch('');
      await loadDistributors();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not mark user as distributor.');
    }
  }

  async function loadAssignableTargets(campaignId: string) {
    if (!campaignId) {
      setAssignableTargets([]);
      return;
    }
    const res = await api.get('/campaign-targets/assignable', { params: { campaignId } });
    setAssignableTargets(res.data.targets || []);
    setSelectedTargetIds([]);
  }

  async function checkCapacity() {
    if (!assignForm.distributorUserId || !assignForm.assignedQuantity) return;
    const res = await api.get('/distributor-inventory/capacity-check', {
      params: {
        distributorUserId: assignForm.distributorUserId,
        quantity: assignForm.assignedQuantity,
      },
    });
    setCapacityWarning(res.data.warnings?.join(' ') || '');
  }

  useEffect(() => {
    checkCapacity().catch(() => undefined);
  }, [assignForm.distributorUserId, assignForm.assignedQuantity]);

  async function assignFlyers(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      const res = await api.post('/distributor-inventory', {
        distributorUserId: Number(assignForm.distributorUserId),
        campaignId: Number(assignForm.campaignId),
        flyerName: assignForm.flyerName || undefined,
        assignedQuantity: Number(assignForm.assignedQuantity || 25),
        campaignTargetIds: selectedTargetIds,
        force: assignForm.force,
      });
      setMessage(`Assigned ${res.data.inventory?.AssignedQuantity || assignForm.assignedQuantity} flyers.`);
      setCapacityWarning('');
      await loadDistributors();
    } catch (err: any) {
      const capacityCheck = err?.response?.data?.capacityCheck;
      if (capacityCheck?.warnings?.length) {
        setCapacityWarning(capacityCheck.warnings.join(' '));
      }
      setError(err?.response?.data?.message || 'Could not assign flyers.');
    }
  }

  return (
    <div>
      <h1>Distributors</h1>
      <p>Manage field distributors, home location, daily flyer capacity, and flyer inventory assignments.</p>

      <div className="card">
        <h2>Mark user as distributor</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Search User ID, name, email" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          <button type="button" onClick={searchUsers}>Search</button>
        </div>
        {searchResults.length ? (
          <ul>
            {searchResults.map((user) => (
              <li key={String(user.ID)}>
                {String(user.User_FirstName || '')} {String(user.User_LastName || '')} ({String(user.User_Id || user.ID)})
                {' · '}
                <button type="button" onClick={() => markUserAsDistributor(Number(user.ID))}>Mark distributor</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {editingUserId ? (
        <form className="card config-grid" onSubmit={saveProfile}>
          <h2>Edit distributor #{editingUserId}</h2>
          <select value={profileForm.employmentType} onChange={(e) => setProfileForm({ ...profileForm, employmentType: e.target.value })}>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
          </select>
          <input placeholder="Home address" value={profileForm.homeAddress} onChange={(e) => setProfileForm({ ...profileForm, homeAddress: e.target.value })} />
          <input placeholder="Home latitude" value={profileForm.homeLatitude} onChange={(e) => setProfileForm({ ...profileForm, homeLatitude: e.target.value })} />
          <input placeholder="Home longitude" value={profileForm.homeLongitude} onChange={(e) => setProfileForm({ ...profileForm, homeLongitude: e.target.value })} />
          <input placeholder="Daily capacity" value={profileForm.defaultDailyFlyerCapacity} onChange={(e) => setProfileForm({ ...profileForm, defaultDailyFlyerCapacity: e.target.value })} />
          <label className="checkbox-label"><input type="checkbox" checked={profileForm.isActive} onChange={(e) => setProfileForm({ ...profileForm, isActive: e.target.checked })} /> Active</label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit">Save profile</button>
            <button type="button" style={{ marginLeft: 8 }} onClick={() => setEditingUserId(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <form className="card config-grid" onSubmit={assignFlyers}>
        <h2>Assign flyers</h2>
        <select
          value={assignForm.distributorUserId}
          onChange={(e) => setAssignForm({ ...assignForm, distributorUserId: e.target.value })}
          required
        >
          <option value="">Select distributor</option>
          {distributors.filter((d) => d.isActive).map((d) => (
            <option key={d.userId} value={d.userId}>
              {d.fullName} · capacity {d.defaultDailyFlyerCapacity}
            </option>
          ))}
        </select>
        <select
          value={assignForm.campaignId}
          onChange={(e) => {
            setAssignForm({ ...assignForm, campaignId: e.target.value });
            loadAssignableTargets(e.target.value);
          }}
          required
        >
          <option value="">Select campaign</option>
          {campaigns.map((c) => (
            <option key={c.CampaignId} value={c.CampaignId}>{c.CampaignName}</option>
          ))}
        </select>
        <input placeholder="Flyer name (optional)" value={assignForm.flyerName} onChange={(e) => setAssignForm({ ...assignForm, flyerName: e.target.value })} />
        <input placeholder="Quantity" value={assignForm.assignedQuantity} onChange={(e) => setAssignForm({ ...assignForm, assignedQuantity: e.target.value })} />
        <label className="checkbox-label"><input type="checkbox" checked={assignForm.force} onChange={(e) => setAssignForm({ ...assignForm, force: e.target.checked })} /> Force over capacity</label>
        {selectedDistributor ? (
          <p style={{ gridColumn: '1 / -1', margin: 0, color: '#475569' }}>
            Today: {selectedDistributor.assignedToday} assigned · {selectedDistributor.deliveredToday} delivered · {selectedDistributor.remainingToday} remaining · capacity {selectedDistributor.defaultDailyFlyerCapacity}
          </p>
        ) : null}
        {capacityWarning ? <p style={{ gridColumn: '1 / -1', color: '#b45309' }}>{capacityWarning}</p> : null}
        {assignableTargets.length ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <strong>Optional route stops (approved targets)</strong>
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
                          : [...current, target.CampaignTargetId]
                      )}
                    />
                    {target.TargetName || 'Target'} · {target.AssignedFlyerName || 'Flyer'} · {[target.PrimaryAddress, target.City].filter(Boolean).join(', ')}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit">Assign flyers</button>
        </div>
      </form>

      {message ? <p style={{ color: '#047857' }}>{message}</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Employment</th>
            <th>Home</th>
            <th>Capacity</th>
            <th>Today assigned</th>
            <th>Delivered</th>
            <th>Remaining</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {distributors.map((d) => (
            <tr key={d.userId}>
              <td>{d.fullName}<br /><small>{d.email || d.userCode}</small></td>
              <td>{d.employmentType || '—'}</td>
              <td>
                {d.homeAddress || '—'}<br />
                <small>{d.homeLatitude != null && d.homeLongitude != null ? `${d.homeLatitude}, ${d.homeLongitude}` : 'No coordinates'}</small>
              </td>
              <td>{d.defaultDailyFlyerCapacity}</td>
              <td>{d.assignedToday}</td>
              <td>{d.deliveredToday}</td>
              <td>{d.remainingToday}</td>
              <td>{d.isActive ? 'Active' : 'Inactive'}</td>
              <td><button type="button" onClick={() => startEdit(d)}>Edit / Assign</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
