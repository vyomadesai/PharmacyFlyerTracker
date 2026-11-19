'use client';

import { useEffect, useState } from 'react';
import { api } from '../../src/services/api';
import type { Market, Pharmacy } from '../../src/types/location';

const emptyForm = {
  pharmacyName: '',
  address1: '',
  address2: '',
  city: '',
  state: 'FL',
  zip: '',
  phone: '',
  fax: '',
  latitude: '',
  longitude: '',
  marketId: '',
  isActive: true,
};

export default function PharmaciesPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterMarketId, setFilterMarketId] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [radiusLat, setRadiusLat] = useState('');
  const [radiusLng, setRadiusLng] = useState('');
  const [radiusMiles, setRadiusMiles] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadMarkets() {
    const res = await api.get('/markets');
    setMarkets(res.data);
  }

  async function loadPharmacies() {
    const res = await api.get('/pharmacies', {
      params: {
        q: search || undefined,
        marketId: filterMarketId || undefined,
        activeOnly: activeOnly ? 'true' : undefined,
        latitude: radiusLat || undefined,
        longitude: radiusLng || undefined,
        radiusMiles: radiusMiles || undefined,
      },
    });
    setPharmacies(res.data);
  }

  useEffect(() => {
    loadMarkets();
  }, []);

  useEffect(() => {
    loadPharmacies();
  }, [search, filterMarketId, activeOnly, radiusLat, radiusLng, radiusMiles]);

  function startEdit(pharmacy: Pharmacy) {
    setEditingId(pharmacy.PharmacyId);
    setForm({
      pharmacyName: pharmacy.PharmacyName || '',
      address1: pharmacy.Address1 || '',
      address2: pharmacy.Address2 || '',
      city: pharmacy.City || '',
      state: pharmacy.State || '',
      zip: pharmacy.Zip || '',
      phone: pharmacy.Phone || '',
      fax: pharmacy.Fax || '',
      latitude: pharmacy.Latitude != null ? String(pharmacy.Latitude) : '',
      longitude: pharmacy.Longitude != null ? String(pharmacy.Longitude) : '',
      marketId: pharmacy.MarketId != null ? String(pharmacy.MarketId) : '',
      isActive: Boolean(pharmacy.IsActive),
    });
    setMessage('');
    setError('');
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage('');
    setError('');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');

    const payload = {
      pharmacyName: form.pharmacyName,
      address1: form.address1 || null,
      address2: form.address2 || null,
      city: form.city || null,
      state: form.state || null,
      zip: form.zip || null,
      phone: form.phone || null,
      fax: form.fax || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      marketId: form.marketId ? Number(form.marketId) : null,
      isActive: form.isActive,
    };

    try {
      if (editingId) {
        await api.put(`/pharmacies/${editingId}`, payload);
        setMessage('Pharmacy updated.');
      } else {
        await api.post('/pharmacies', payload);
        setMessage('Pharmacy created.');
      }
      resetForm();
      loadPharmacies();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save pharmacy.');
    }
  }

  return (
    <div>
      <h1>Pharmacies</h1>
      <p>Create flyer drop pharmacy targets and assign them to a market.</p>

      <div className="card" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <input placeholder="Search name/address" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filterMarketId} onChange={(e) => setFilterMarketId(e.target.value)}>
          <option value="">All markets</option>
          {markets.map((market) => (
            <option key={market.MarketId} value={market.MarketId}>
              {market.MarketName} ({market.MarketNumber})
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
        <input placeholder="Radius lat" value={radiusLat} onChange={(e) => setRadiusLat(e.target.value)} />
        <input placeholder="Radius lng" value={radiusLng} onChange={(e) => setRadiusLng(e.target.value)} />
        <input placeholder="Radius miles" value={radiusMiles} onChange={(e) => setRadiusMiles(e.target.value)} />
      </div>

      <form className="card" onSubmit={save} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <h2 style={{ gridColumn: '1 / -1', margin: 0 }}>{editingId ? `Edit Pharmacy #${editingId}` : 'Create Pharmacy'}</h2>
        <input placeholder="Pharmacy name" value={form.pharmacyName} onChange={(e) => setForm({ ...form, pharmacyName: e.target.value })} required />
        <select value={form.marketId} onChange={(e) => setForm({ ...form, marketId: e.target.value })}>
          <option value="">No market</option>
          {markets.map((market) => (
            <option key={market.MarketId} value={market.MarketId}>
              {market.MarketName} ({market.MarketNumber})
            </option>
          ))}
        </select>
        <input placeholder="Address 1" value={form.address1} onChange={(e) => setForm({ ...form, address1: e.target.value })} />
        <input placeholder="Address 2" value={form.address2} onChange={(e) => setForm({ ...form, address2: e.target.value })} />
        <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        <input placeholder="Zip" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Fax" value={form.fax} onChange={(e) => setForm({ ...form, fax: e.target.value })} />
        <input placeholder="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
        <input placeholder="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <button type="submit">{editingId ? 'Update Pharmacy' : 'Create Pharmacy'}</button>
          {editingId ? <button type="button" onClick={resetForm}>Cancel Edit</button> : null}
        </div>
        {message ? <p style={{ gridColumn: '1 / -1', color: '#047857', margin: 0 }}>{message}</p> : null}
        {error ? <p style={{ gridColumn: '1 / -1', color: '#b91c1c', margin: 0 }}>{error}</p> : null}
      </form>

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Market</th>
            <th>City</th>
            <th>Active</th>
            <th>Distance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pharmacies.map((pharmacy) => (
            <tr key={pharmacy.PharmacyId}>
              <td>{pharmacy.PharmacyId}</td>
              <td>{pharmacy.PharmacyName}</td>
              <td>{pharmacy.MarketName || '—'}</td>
              <td>{pharmacy.City}</td>
              <td>{String(pharmacy.IsActive)}</td>
              <td>{pharmacy.DistanceMiles != null ? `${pharmacy.DistanceMiles} mi` : '—'}</td>
              <td><button type="button" onClick={() => startEdit(pharmacy)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
