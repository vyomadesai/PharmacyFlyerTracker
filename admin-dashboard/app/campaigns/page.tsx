'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Pagination from '../../src/components/Pagination';
import { api } from '../../src/services/api';
import { DEFAULT_PAGE_SIZE, type PaginatedResponse } from '../../src/types/pagination';

type CampaignRow = {
  CampaignId: number;
  CampaignName: string;
  Description?: string | null;
  FlyerTitle?: string | null;
  FlyerIdentifier?: string | null;
  FlyerCategory?: string | null;
  TargetAudience?: string | null;
  DefaultVisitFrequencyDays?: number | null;
  IsActive: boolean;
  CreatedDate?: string;
};

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    campaignName: '',
    flyerCategory: '',
    targetAudience: '',
    defaultVisitFrequencyDays: '30',
    description: '',
  });

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<PaginatedResponse<CampaignRow>>('/campaigns', {
        params: { page: nextPage, pageSize: DEFAULT_PAGE_SIZE },
      });
      setCampaigns(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load campaigns.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.push('/');
      return;
    }
    load(page);
  }, [router, load, page]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/campaigns', {
        campaignName: form.campaignName,
        flyerCategory: form.flyerCategory || null,
        targetAudience: form.targetAudience || null,
        description: form.description || null,
        defaultVisitFrequencyDays: Number(form.defaultVisitFrequencyDays || 0) || null,
      });
      setForm({
        campaignName: '',
        flyerCategory: '',
        targetAudience: '',
        defaultVisitFrequencyDays: '30',
        description: '',
      });
      setPage(1);
      await load(1);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create campaign.');
    }
  }

  return (
    <div>
      <h1>Campaigns / Flyers</h1>
      {error ? <div className="card workflow-error">{error}</div> : null}
      {loading ? <p>Loading campaigns…</p> : null}
      <form className="card campaign-create-form" onSubmit={create}>
        <label>
          Campaign name
          <input
            placeholder="Diabetes flyer campaign"
            value={form.campaignName}
            onChange={(e) => setForm({ ...form, campaignName: e.target.value })}
            required
          />
        </label>
        <label>
          Flyer category
          <input
            placeholder="Diabetes, health checkup"
            value={form.flyerCategory}
            onChange={(e) => setForm({ ...form, flyerCategory: e.target.value })}
          />
        </label>
        <label>
          Target audience
          <input
            placeholder="Endocrinologists, primary care"
            value={form.targetAudience}
            onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
          />
        </label>
        <label className="field-frequency">
          Default freq days
          <input
            type="number"
            min={1}
            value={form.defaultVisitFrequencyDays}
            onChange={(e) => setForm({ ...form, defaultVisitFrequencyDays: e.target.value })}
          />
        </label>
        <label>
          Description
          <input
            placeholder="Campaign notes"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <button type="submit">Create Campaign</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Campaign</th><th>Flyer</th><th>Category</th><th>Audience</th><th>Frequency</th><th>Active</th><th>Created</th></tr></thead>
          <tbody>
            {campaigns.map(c => <tr key={c.CampaignId}><td>{c.CampaignId}</td><td><strong>{c.CampaignName}</strong><br /><small>{c.Description}</small></td><td>{c.FlyerTitle}<br /><small>{c.FlyerIdentifier}</small></td><td>{c.FlyerCategory}</td><td>{c.TargetAudience}</td><td>{c.DefaultVisitFrequencyDays || '-'}</td><td>{String(c.IsActive)}</td><td>{c.CreatedDate}</td></tr>)}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
