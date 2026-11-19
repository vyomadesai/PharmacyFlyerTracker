'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';
import SpecialtySearchPicker from '../../src/components/SpecialtySearchPicker';

const DEFAULT_MATCH_MODE = 'secondary_only' as const;

type MatchMode = 'primary_only' | 'secondary_only' | 'primary_or_secondary';

const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  primary_only: 'Primary only (Level 1)',
  secondary_only: 'Secondary only (Level 2)',
  primary_or_secondary: 'Primary or Secondary (Levels 1 & 2)',
};

function parseMatchMode(value: unknown): MatchMode {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'primary_only' || normalized === 'secondary_only' || normalized === 'primary_or_secondary') {
    return normalized;
  }
  return DEFAULT_MATCH_MODE;
}

type SpecialtyOption = {
  RecID: number;
  SpecialityCode: string;
  Description: string;
  source?: 'local' | 'npi' | 'matched';
  taxonomyCodes?: string[];
  npiDescriptions?: string[];
};

type SelectedSpecialty = {
  key: string;
  specialityRecId: number;
  specialityCode: string;
  description: string;
  matchLevel: '1' | '2' | '3' | 'any';
  source?: 'local' | 'npi' | 'matched';
  taxonomyCodes?: string[];
};

type CampaignSpecialtyRow = {
  campaignSpecialtyV2Id: number;
  specialityRecId: number | null;
  specialityCode: string | null;
  description: string | null;
  matchLevel: string;
  matchMode: string;
};

type RoutePlannerCampaign = {
  campaignId: number;
  campaignName: string;
  description?: string | null;
  flyerTitle?: string | null;
  isActive?: boolean | number;
  createdDate?: string;
  specialties: CampaignSpecialtyRow[];
};

type SpecialtyLabelInput = {
  specialityCode?: string | null;
  description?: string | null;
  RecID?: number;
  SpecialityCode?: string | null;
  Description?: string | null;
};

function specialtyKey(row: { specialityCode?: string | null; SpecialityCode?: string | null; key?: string; RecID?: number }) {
  const code = row.specialityCode || row.SpecialityCode || '';
  if (code) return code;
  if (row.key) return row.key;
  return row.RecID != null ? String(row.RecID) : 'unknown';
}

function specialtyLabel(row: SpecialtyLabelInput & { source?: string; taxonomyCodes?: string[] }) {
  const code = row.specialityCode || row.SpecialityCode || '';
  const desc = row.description || row.Description || '';
  const base = code && desc && code !== desc ? `${code} — ${desc}` : desc || code || (row.RecID != null ? `RecID ${row.RecID}` : 'Unknown');
  if (row.source === 'matched' || (row.taxonomyCodes && row.taxonomyCodes.length)) return `${base} (local+NPI)`;
  if (row.source === 'npi') return `${base} (NPI)`;
  if (row.source === 'local') return `${base} (local)`;
  return base;
}

const PREVIEW_PAGE_SIZE = 25;

type PreviewDoctor = {
  doctorId: number;
  doctorName: string;
  npi: string | null;
  source: 'local' | 'npi';
  matchedSpecialityCode: string | null;
  matchedSpecialityDescription: string | null;
  addressStreet?: string | null;
  addressCity: string | null;
  addressZip: string | null;
};

function cleanName(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function initialsFor(name: string) {
  const parts = cleanName(name).split(' ').filter((part) => !/^(dr|md|do|dpm|pa|np|aprn|rn)\.?$/i.test(part));
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase() || '?';
}

function locationLine(doctor: PreviewDoctor) {
  return [doctor.addressStreet, doctor.addressCity, doctor.addressZip].filter(Boolean).join(', ') || 'No address';
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    pageCount,
    total,
    rows: rows.slice(start, start + pageSize),
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  };
}

function doctorMatchesQuery(doctor: PreviewDoctor, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    doctor.doctorName,
    doctor.npi,
    doctor.matchedSpecialityCode,
    doctor.matchedSpecialityDescription,
    doctor.addressStreet,
    doctor.addressCity,
    doctor.addressZip,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const npiQuery = q.replace(/\D/g, '');
  const npiValue = (doctor.npi || '').replace(/\D/g, '');
  return haystack.includes(q) || (npiQuery.length > 0 && npiValue.includes(npiQuery));
}

function DoctorPreviewTable({
  title,
  subtitle,
  emptyLabel,
  variant,
  doctors,
  page,
  onPageChange,
}: {
  title: string;
  subtitle: string;
  emptyLabel: string;
  variant: 'local' | 'npi';
  doctors: PreviewDoctor[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => doctors.filter((doctor) => doctorMatchesQuery(doctor, query)),
    [doctors, query],
  );
  const paged = paginate(filtered, page, PREVIEW_PAGE_SIZE);
  const searching = Boolean(query.trim());

  return (
    <section className={`match-panel match-panel-${variant}`}>
      <div className="match-panel-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="match-count-pill">
          {searching ? `${filtered.length}/${doctors.length}` : doctors.length}
        </span>
      </div>
      {doctors.length > 0 ? (
        <div className="match-search">
          <input
            type="search"
            value={query}
            placeholder="Search name, NPI, specialty, city…"
            onChange={(e) => {
              setQuery(e.target.value);
              onPageChange(1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
        </div>
      ) : null}
      {doctors.length === 0 ? (
        <div className="match-empty">{emptyLabel}</div>
      ) : filtered.length === 0 ? (
        <div className="match-empty">No doctors match “{query.trim()}”.</div>
      ) : (
        <>
          <div className="match-table-wrap">
            <table className="match-table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>NPI</th>
                  <th>Specialty</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((doctor) => {
                  const name = cleanName(doctor.doctorName);
                  const specialty = doctor.matchedSpecialityDescription || doctor.matchedSpecialityCode || '—';
                  return (
                    <tr key={`${doctor.source}-${doctor.doctorId}-${doctor.npi || ''}`}>
                      <td>
                        <div className="match-doctor">
                          <span className="match-avatar">{initialsFor(name)}</span>
                          <div>
                            <div className="match-doctor-name">{name}</div>
                            <div className="match-doctor-meta">{locationLine(doctor)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="match-npi">{doctor.npi || '—'}</td>
                      <td><span className="match-pill" title={specialty}>{specialty}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="match-pager">
            <span>
              {paged.from}–{paged.to} of {paged.total}
              {searching ? ` (filtered from ${doctors.length})` : ''}
            </span>
            <div className="match-pager-controls">
              <button
                type="button"
                className="btn-secondary"
                disabled={paged.page <= 1}
                onClick={() => onPageChange(paged.page - 1)}
              >
                Previous
              </button>
              <span>Page {paged.page} of {paged.pageCount}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={paged.page >= paged.pageCount}
                onClick={() => onPageChange(paged.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function campaignToSelectedSpecialties(c: RoutePlannerCampaign): SelectedSpecialty[] {
  const seen = new Set<string>();
  const rows: SelectedSpecialty[] = [];
  for (const s of c.specialties) {
    const key = s.specialityCode || (s.specialityRecId != null ? String(s.specialityRecId) : `row-${s.campaignSpecialtyV2Id}`);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      specialityRecId: Number(s.specialityRecId) || 0,
      specialityCode: s.specialityCode || '',
      description: s.description || '',
      matchLevel: (['1', '2', '3', 'any'].includes(s.matchLevel) ? s.matchLevel : 'any') as SelectedSpecialty['matchLevel'],
      source: s.specialityRecId ? 'matched' : 'npi',
    });
  }
  return rows.filter((s) => s.specialityRecId > 0 || s.specialityCode || s.description);
}

function ModalOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function CampaignBuilderPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<RoutePlannerCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [campaignName, setCampaignName] = useState('');
  const [description, setDescription] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>(DEFAULT_MATCH_MODE);

  const [allSpecialties, setAllSpecialties] = useState<SpecialtyOption[]>([]);
  const [loadingSpecialties, setLoadingSpecialties] = useState(true);
  const [selectedSpecialties, setSelectedSpecialties] = useState<SelectedSpecialty[]>([]);

  const [editCampaign, setEditCampaign] = useState<RoutePlannerCampaign | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMatchMode, setEditMatchMode] = useState<MatchMode>(DEFAULT_MATCH_MODE);
  const [editSpecialties, setEditSpecialties] = useState<SelectedSpecialty[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteCampaign, setDeleteCampaign] = useState<RoutePlannerCampaign | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState<{
    counts: { local: number; npi: number; total: number };
    localDoctors: PreviewDoctor[];
    npiDoctors: PreviewDoctor[];
  } | null>(null);
  const [localPage, setLocalPage] = useState(1);
  const [npiPage, setNpiPage] = useState(1);

  const loadSpecialties = useCallback(async () => {
    setLoadingSpecialties(true);
    try {
      const res = await api.get<SpecialtyOption[]>('/route-planner/specialties');
      setAllSpecialties(res.data);
    } catch {
      setAllSpecialties([]);
    } finally {
      setLoadingSpecialties(false);
    }
  }, []);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<RoutePlannerCampaign[]>('/route-planner/campaigns', {
        params: { includeInactive: true },
      });
      setCampaigns(res.data);
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError(err?.response?.data?.message || 'Could not load flyers.');
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
    loadCampaigns();
    loadSpecialties();
  }, [router, loadCampaigns, loadSpecialties]);

  const availableSpecialties = useMemo(() => {
    const selectedKeys = new Set(selectedSpecialties.map((s) => s.key));
    return allSpecialties.filter((opt) => !selectedKeys.has(specialtyKey(opt)));
  }, [allSpecialties, selectedSpecialties]);

  const editAvailableSpecialties = useMemo(() => {
    const selectedKeys = new Set(editSpecialties.map((s) => s.key));
    return allSpecialties.filter((opt) => !selectedKeys.has(specialtyKey(opt)));
  }, [allSpecialties, editSpecialties]);

  function addSpecialty(option: SpecialtyOption) {
    const key = specialtyKey(option);
    if (selectedSpecialties.some((s) => s.key === key)) return;
    setSelectedSpecialties((prev) => [
      ...prev,
      {
        key,
        specialityRecId: option.RecID,
        specialityCode: option.SpecialityCode,
        description: option.Description,
        matchLevel: 'any',
        source: option.source,
        taxonomyCodes: option.taxonomyCodes || [],
      },
    ]);
  }

  function removeSpecialty(key: string) {
    setSelectedSpecialties((prev) => prev.filter((s) => s.key !== key));
    setPreview(null);
  }

  async function previewMatchingDoctors() {
    if (!selectedSpecialties.length) {
      setPreviewError('Add at least one doctor specialty.');
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await api.post('/route-planner/preview-doctors', {
        specialties: selectedSpecialties.map((s) => ({
          specialityRecId: s.specialityRecId,
          specialityCode: s.specialityCode,
          description: s.description,
          matchLevel: s.matchLevel,
        })),
      });
      const localDoctors: PreviewDoctor[] = res.data.localDoctors || [];
      const npiDoctors: PreviewDoctor[] = res.data.npiDoctors || [];
      setPreview({
        counts: res.data.counts || {
          local: localDoctors.length,
          npi: npiDoctors.length,
          total: localDoctors.length + npiDoctors.length,
        },
        localDoctors,
        npiDoctors,
      });
      setLocalPage(1);
      setNpiPage(1);
    } catch (err: any) {
      setPreview(null);
      setPreviewError(err?.response?.data?.message || 'Could not load matching doctors.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function openEditModal(campaign: RoutePlannerCampaign) {
    setEditCampaign(campaign);
    setEditName(campaign.campaignName);
    setEditDescription(campaign.description || '');
    setEditMatchMode(parseMatchMode(campaign.specialties[0]?.matchMode));
    setEditSpecialties(campaignToSelectedSpecialties(campaign));
    setEditError('');
  }

  function closeEditModal() {
    if (editSaving) return;
    setEditCampaign(null);
    setEditError('');
  }

  function addEditSpecialty(option: SpecialtyOption) {
    const key = specialtyKey(option);
    if (editSpecialties.some((s) => s.key === key)) return;
    setEditSpecialties((prev) => [
      ...prev,
      {
        key,
        specialityRecId: option.RecID,
        specialityCode: option.SpecialityCode,
        description: option.Description,
        matchLevel: 'any',
        source: option.source,
        taxonomyCodes: option.taxonomyCodes || [],
      },
    ]);
  }

  function removeEditSpecialty(key: string) {
    setEditSpecialties((prev) => prev.filter((s) => s.key !== key));
  }

  async function saveEditModal() {
    if (!editCampaign) return;
    setEditError('');

    if (!editName.trim()) {
      setEditError('Flyer name is required.');
      return;
    }
    if (!editSpecialties.length) {
      setEditError('Add at least one doctor specialty.');
      return;
    }

    setEditSaving(true);
    try {
      await api.put(`/route-planner/campaigns/${editCampaign.campaignId}`, {
        campaignName: editName.trim(),
        description: editDescription.trim() || null,
        matchMode: editMatchMode,
        specialties: editSpecialties.map((s) => ({
          specialityRecId: s.specialityRecId,
          specialityCode: s.specialityCode,
          description: s.description,
          matchLevel: s.matchLevel,
        })),
      });
      setEditCampaign(null);
      setSuccess('Flyer updated.');
      await loadCampaigns();
    } catch (err: any) {
      setEditError(err?.response?.data?.message || 'Could not update flyer.');
    } finally {
      setEditSaving(false);
    }
  }

  function openDeleteModal(campaign: RoutePlannerCampaign) {
    setDeleteCampaign(campaign);
    setDeleteError('');
  }

  function closeDeleteModal() {
    if (deleteSaving) return;
    setDeleteCampaign(null);
    setDeleteError('');
  }

  async function confirmDeleteModal() {
    if (!deleteCampaign) return;
    setDeleteSaving(true);
    setDeleteError('');
    try {
      await api.delete(`/route-planner/campaigns/${deleteCampaign.campaignId}`);
      setDeleteCampaign(null);
      setSuccess(`Flyer "${deleteCampaign.campaignName}" deleted.`);
      await loadCampaigns();
    } catch (err: any) {
      setDeleteError(err?.response?.data?.message || 'Could not delete flyer.');
    } finally {
      setDeleteSaving(false);
    }
  }

  function isCampaignActive(c: RoutePlannerCampaign) {
    return c.isActive !== false && c.isActive !== 0;
  }

  async function toggleCampaignActive(c: RoutePlannerCampaign) {
    const nextActive = !isCampaignActive(c);
    setTogglingId(c.campaignId);
    setError('');
    setSuccess('');
    try {
      await api.patch(`/route-planner/campaigns/${c.campaignId}/active`, { isActive: nextActive });
      setSuccess(`${c.campaignName} is now ${nextActive ? 'active' : 'inactive'}.`);
      await loadCampaigns();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not update flyer status.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!campaignName.trim()) {
      setError('Flyer name is required.');
      return;
    }
    if (!selectedSpecialties.length) {
      setError('Add at least one doctor specialty.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/route-planner/campaigns', {
        campaignName: campaignName.trim(),
        description: description.trim() || null,
        matchMode,
        specialties: selectedSpecialties.map((s) => ({
          specialityRecId: s.specialityRecId,
          specialityCode: s.specialityCode,
          description: s.description,
          matchLevel: s.matchLevel,
        })),
      });
      setCampaignName('');
      setDescription('');
      setMatchMode(DEFAULT_MATCH_MODE);
      setSelectedSpecialties([]);
      setSuccess('Flyer saved with specialty rules.');
      await loadCampaigns();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create flyer.');
    } finally {
      setSaving(false);
    }
  }

  const activeFlyerCount = campaigns.filter(isCampaignActive).length;

  return (
    <div>
      <PageHeader
        eyebrow="Planning"
        title="Flyer Builder"
        subtitle="Create a flyer and the doctor specialties it targets. One specialty pick covers both the local specialty list (CAR, ENDO, PCP, …) and the matching NPI taxonomy codes. Only active flyers are used when a rep checks in on Smart Route."
        actions={
          <>
            <span className="badge badge-success badge-dot">{activeFlyerCount} active</span>
            <span className="badge badge-muted">{campaigns.length} total</span>
          </>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <form className="card" onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>Create a flyer</h2>
            <p>Name the flyer, choose how specialties should match, then add one or more doctor specialties.</p>
          </div>
        </div>

        <div className="form-grid">
          <label className="form-field">
            Flyer name
            <input
              placeholder="Cardiology Flyer"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              required
            />
          </label>

          <label className="form-field">
            Description <span className="form-help">(optional)</span>
            <input
              placeholder="Optional notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="form-field">
            Specialty match mode
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as MatchMode)}
            >
              {(Object.keys(MATCH_MODE_LABELS) as MatchMode[]).map((mode) => (
                <option key={mode} value={mode}>{MATCH_MODE_LABELS[mode]}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="form-field">
          Doctor specialties
          <SpecialtySearchPicker
            options={availableSpecialties}
            onSelect={addSpecialty}
            loading={loadingSpecialties}
            disabled={!loadingSpecialties && availableSpecialties.length === 0}
            emptyMessage={
              allSpecialties.length
                ? 'All specialties already added'
                : 'No specialties available'
            }
          />
        </label>

        {selectedSpecialties.length > 0 ? (
          <div className="chip-row">
            {selectedSpecialties.map((s) => (
              <span key={s.key} className="specialty-chip">
                {specialtyLabel(s)}
                <button
                  type="button"
                  onClick={() => removeSpecialty(s.key)}
                  aria-label="Remove specialty"
                  className="specialty-chip-remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>No specialties selected yet.</p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save flyer'}
          </button>
          <button type="button" className="btn-ghost" onClick={previewMatchingDoctors} disabled={previewLoading || !selectedSpecialties.length}>
            {previewLoading ? 'Matching doctors…' : 'Preview matching doctors'}
          </button>
          <span className="muted" style={{ fontSize: 12.5 }}>Preview shows local + NPI registry doctors for the selected specialties before you save.</span>
        </div>

        <div>
          {previewError ? <div className="alert alert-error">{previewError}</div> : null}
          {preview ? (
            <div className="match-preview">
              <div className="match-preview-stats">
                <div className="match-stat">
                  <strong>{preview.counts.total}</strong>
                  <span>Total matched</span>
                </div>
                <div className="match-stat match-stat-local">
                  <strong>{preview.counts.local}</strong>
                  <span>Local specialty</span>
                </div>
                <div className="match-stat match-stat-npi">
                  <strong>{preview.counts.npi}</strong>
                  <span>NPI registry</span>
                </div>
              </div>
              <div className="match-preview-grid">
                <DoctorPreviewTable
                  title="Local database"
                  subtitle="Doctors assigned this specialty in Master_PrescribSpeciality"
                  emptyLabel="No matching doctors in the local specialty tables."
                  variant="local"
                  doctors={preview.localDoctors}
                  page={localPage}
                  onPageChange={setLocalPage}
                />
                <DoctorPreviewTable
                  title="NPI registry"
                  subtitle="Matched from NPI registry (not from local specialty)"
                  emptyLabel="No matching NPI registry doctors."
                  variant="npi"
                  doctors={preview.npiDoctors}
                  page={npiPage}
                  onPageChange={setNpiPage}
                />
              </div>
            </div>
          ) : null}
        </div>
      </form>

      <div className="card table-card">
        <div className="card-head" style={{ padding: '16px 20px 12px', marginBottom: 0 }}>
          <div>
            <h2>Flyers</h2>
            <p>Inactive flyers stay here but are skipped when reps check in. Edit specialties any time.</p>
          </div>
          {loading ? <span className="loading-row"><span className="spinner" /> Loading flyers…</span> : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Flyer</th>
                <th>Specialties</th>
                <th>Match mode</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="table-empty">No flyers with specialty rules yet. Create your first one above.</td>
                </tr>
              ) : null}
              {campaigns.map((c) => {
                const mode = parseMatchMode(c.specialties[0]?.matchMode);
                const active = isCampaignActive(c);
                return (
                  <tr key={c.campaignId} style={!active ? { opacity: 0.65 } : undefined}>
                    <td className="cell-mono">{c.campaignId}</td>
                    <td>
                      <div className="cell-primary">{c.campaignName}</div>
                      {c.description ? <div className="cell-secondary">{c.description}</div> : null}
                    </td>
                    <td>
                      {c.specialties.length ? (
                        <div className="chip-row">
                          {c.specialties.map((s) => (
                            <span key={s.campaignSpecialtyV2Id} className="badge badge-primary" title={specialtyLabel(s)}>
                              {s.specialityCode || s.description || '—'}
                              {s.matchLevel && s.matchLevel !== 'any' ? ` · L${s.matchLevel}` : ''}
                            </span>
                          ))}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 13 }}>{MATCH_MODE_LABELS[mode]}</td>
                    <td>
                      <span className={`badge ${active ? 'badge-success badge-dot' : 'badge-muted'}`}>
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="cell-nowrap">{c.createdDate ? String(c.createdDate).slice(0, 10) : '—'}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className={`btn-sm${active ? ' btn-ghost' : ''}`}
                          onClick={() => toggleCampaignActive(c)}
                          disabled={togglingId === c.campaignId}
                        >
                          {togglingId === c.campaignId
                            ? '…'
                            : active
                              ? 'Deactivate'
                              : 'Activate'}
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => openEditModal(c)}>Edit</button>
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => openDeleteModal(c)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editCampaign ? (
        <ModalOverlay onClose={closeEditModal}>
          <div className="modal-header">
            <h2 className="modal-title">Edit flyer</h2>
            <button type="button" className="modal-close" onClick={closeEditModal} aria-label="Close">×</button>
          </div>
          <p style={{ color: '#64748b', marginTop: 0, marginBottom: 12 }}>
            Flyer ID {editCampaign.campaignId}
          </p>
          {editError ? <div className="alert alert-error">{editError}</div> : null}
          <div className="modal-form">
            <label>
              Flyer name
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </label>
            <label>
              Description
              <input
                placeholder="Optional notes"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </label>
            <label>
              Specialty match mode
              <select value={editMatchMode} onChange={(e) => setEditMatchMode(e.target.value as MatchMode)}>
                {(Object.keys(MATCH_MODE_LABELS) as MatchMode[]).map((mode) => (
                  <option key={mode} value={mode}>{MATCH_MODE_LABELS[mode]}</option>
                ))}
              </select>
            </label>
            <label>
              Doctor specialties
              <SpecialtySearchPicker
                options={editAvailableSpecialties}
                onSelect={addEditSpecialty}
                loading={loadingSpecialties}
                disabled={!loadingSpecialties && editAvailableSpecialties.length === 0}
                emptyMessage="All specialties already added"
              />
            </label>
            {editSpecialties.length > 0 ? (
              <div className="chip-row">
                {editSpecialties.map((s) => (
                  <span key={s.key} className="specialty-chip">
                    {specialtyLabel(s)}
                    <button
                      type="button"
                      onClick={() => removeEditSpecialty(s.key)}
                      aria-label="Remove specialty"
                      className="specialty-chip-remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>No specialties selected.</p>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={closeEditModal} disabled={editSaving}>
              Cancel
            </button>
            <button type="button" onClick={saveEditModal} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </ModalOverlay>
      ) : null}

      {deleteCampaign ? (
        <ModalOverlay onClose={closeDeleteModal}>
          <div className="modal-header">
            <h2 className="modal-title">Delete flyer</h2>
            <button type="button" className="modal-close" onClick={closeDeleteModal} aria-label="Close">×</button>
          </div>
          <p style={{ color: '#334155', lineHeight: 1.5 }}>
            Delete <strong>{deleteCampaign.campaignName}</strong> (ID {deleteCampaign.campaignId})?
            This removes it from Route Planner and from mobile check-in. Routes and deliveries already saved with this flyer are not deleted.
          </p>
          {deleteError ? <div className="alert alert-error" style={{ marginTop: 12 }}>{deleteError}</div> : null}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={closeDeleteModal} disabled={deleteSaving}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={confirmDeleteModal} disabled={deleteSaving}>
              {deleteSaving ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </ModalOverlay>
      ) : null}
    </div>
  );
}
