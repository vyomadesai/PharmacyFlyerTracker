'use client';

import { useEffect, useState } from 'react';
import { api } from '../../src/services/api';
import type { Market } from '../../src/types/location';

const emptyForm = {
  marketName: '',
  marketNumber: '',
  centerAddress: '',
  centerCity: '',
  centerState: 'FL',
  centerZip: '',
  centerLatitude: '',
  centerLongitude: '',
  radiusMiles: '10',
  isActive: true,
};

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const res = await api.get('/markets', { params: { activeOnly: activeOnly ? 'true' : undefined } });
    setMarkets(res.data);
  }

  useEffect(() => { load(); }, [activeOnly]);

  function startEdit(market: Market) {
    setEditingId(market.MarketId);
    setForm({
      marketName: market.MarketName || '',
      marketNumber: market.MarketNumber || '',
      centerAddress: market.CenterAddress || '',
      centerCity: market.CenterCity || '',
      centerState: market.CenterState || '',
      centerZip: market.CenterZip || '',
      centerLatitude: market.CenterLatitude != null ? String(market.CenterLatitude) : '',
      centerLongitude: market.CenterLongitude != null ? String(market.CenterLongitude) : '',
      radiusMiles: String(market.RadiusMiles ?? 10),
      isActive: Boolean(market.IsActive),
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
      marketName: form.marketName,
      marketNumber: form.marketNumber,
      centerAddress: form.centerAddress || null,
      centerCity: form.centerCity || null,
      centerState: form.centerState || null,
      centerZip: form.centerZip || null,
      centerLatitude: form.centerLatitude ? Number(form.centerLatitude) : null,
      centerLongitude: form.centerLongitude ? Number(form.centerLongitude) : null,
      radiusMiles: Number(form.radiusMiles || 10),
      isActive: form.isActive,
    };

    try {
      if (editingId) {
        await api.put(`/markets/${editingId}`, payload);
        setMessage('Market updated.');
      } else {
        await api.post('/markets', payload);
        setMessage('Market created.');
      }
      resetForm();
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save market.');
    }
  }

  return (
    <div>
      <h1>Markets</h1>
      <p>Define active market areas such as Pinellas Park and St. Petersburg with center location and default radius.</p>

      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Show active markets only
        </label>
      </div>

      <form className="card" onSubmit={save} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <h2 style={{ gridColumn: '1 / -1', margin: 0 }}>{editingId ? `Edit Market #${editingId}` : 'Create Market'}</h2>
        <input placeholder="Market name" value={form.marketName} onChange={(e) => setForm({ ...form, marketName: e.target.value })} required />
        <input placeholder="Market number" value={form.marketNumber} onChange={(e) => setForm({ ...form, marketNumber: e.target.value })} required />
        <input placeholder="Center address" value={form.centerAddress} onChange={(e) => setForm({ ...form, centerAddress: e.target.value })} />
        <input placeholder="Center city" value={form.centerCity} onChange={(e) => setForm({ ...form, centerCity: e.target.value })} />
        <input placeholder="Center state" value={form.centerState} onChange={(e) => setForm({ ...form, centerState: e.target.value })} />
        <input placeholder="Center zip" value={form.centerZip} onChange={(e) => setForm({ ...form, centerZip: e.target.value })} />
        <input placeholder="Center latitude" value={form.centerLatitude} onChange={(e) => setForm({ ...form, centerLatitude: e.target.value })} />
        <input placeholder="Center longitude" value={form.centerLongitude} onChange={(e) => setForm({ ...form, centerLongitude: e.target.value })} />
        <input placeholder="Radius miles" value={form.radiusMiles} onChange={(e) => setForm({ ...form, radiusMiles: e.target.value })} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <button type="submit">{editingId ? 'Update Market' : 'Create Market'}</button>
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
            <th>Number</th>
            <th>City</th>
            <th>Radius</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => (
            <tr key={market.MarketId}>
              <td>{market.MarketId}</td>
              <td>{market.MarketName}</td>
              <td>{market.MarketNumber}</td>
              <td>{market.CenterCity}</td>
              <td>{market.RadiusMiles} mi</td>
              <td>{String(market.IsActive)}</td>
              <td><button type="button" onClick={() => startEdit(market)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
