'use client';

import './map.css';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';
import {
  CampaignOption,
  formatSubmittedAt,
  MapDelivery,
  statusColor
} from '../../src/types/delivery';

const DeliveryTraceMap = dynamic(
  () => import('../../src/components/DeliveryTraceMap'),
  {
    ssr: false,
    loading: () => (
      <div className="map-loading">
        <div className="map-loader" />
        <span>Loading delivery map...</span>
      </div>
    )
  }
);

const STATUS_FILTERS = [
  { label: 'All statuses', value: '' },
  { label: 'Flyer accepted', value: 'Flyer accepted' },
  { label: 'Left with staff', value: 'Left with staff' },
  { label: 'Interested', value: 'Interested' },
  { label: 'Follow up requested', value: 'Follow up requested' },
  { label: 'Doctor not available', value: 'Doctor not available' },
  { label: 'Clinic closed', value: 'Clinic closed' },
  { label: 'Flyer declined', value: 'Flyer declined' },
  { label: 'Not interested', value: 'Not interested' }
];

export default function MapPage() {
  const [deliveries, setDeliveries] = useState<MapDelivery[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [responseStatus, setResponseStatus] = useState('');
  const [showRoute, setShowRoute] = useState(true);
  const [loadingPhotoId, setLoadingPhotoId] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    api
      .get('/campaigns')
      .then((res) => setCampaigns(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function loadMapData() {
      try {
        setLoading(true);
        setError('');

        const params: Record<string, string> = {};

        if (campaignId) params.campaignId = campaignId;
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
        if (responseStatus) params.responseStatus = responseStatus;

        const res = await api.get('/deliveries/map', { params });

        setDeliveries(res.data);

        setSelectedId((current) => {
          if (
            current &&
            res.data.some((item: MapDelivery) => item.DeliveryId === current)
          ) {
            return current;
          }

          return res.data[0]?.DeliveryId ?? null;
        });
      } catch (e: any) {
        setError(
          e?.response?.data?.message ||
            'Could not load delivery map data. Log in and check the backend API URL.'
        );
        setDeliveries([]);
        setSelectedId(null);
      } finally {
        setLoading(false);
      }
    }

    loadMapData();
  }, [campaignId, dateFrom, dateTo, responseStatus]);

  const selected = useMemo(
    () =>
      deliveries.find((delivery) => delivery.DeliveryId === selectedId) || null,
    [deliveries, selectedId]
  );

  const stats = useMemo(() => {
    const withGps = deliveries.filter((delivery) =>
      Number.isFinite(Number(delivery.Latitude))
    ).length;

    const followUps = deliveries.filter((delivery) =>
      Boolean(delivery.FollowUpRequired)
    ).length;

    const withPhotos = deliveries.filter((delivery) =>
      Boolean(delivery.HasPhoto)
    ).length;

    return {
      total: deliveries.length,
      withGps,
      followUps,
      withPhotos
    };
  }, [deliveries]);

  async function viewPhoto(deliveryId: number) {
    setPhotoError('');
    setLoadingPhotoId(deliveryId);

    try {
      const res = await api.get(`/deliveries/${deliveryId}/photo`, {
        responseType: 'blob'
      });

      const headerContentType = res.headers['content-type'];
      const contentType =
        typeof headerContentType === 'string'
          ? headerContentType
          : 'image/jpeg';

      const blob = new Blob([res.data], { type: contentType });
      const photoUrl = window.URL.createObjectURL(blob);

      const win = window.open(photoUrl, '_blank', 'noopener,noreferrer');

      if (!win) {
        setPhotoError(
          'Popup blocked. Please allow popups for this site and try again.'
        );
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(photoUrl);
      }, 60000);
    } catch (err: any) {
      const status = err?.response?.status;

      if (status === 401) {
        setPhotoError('Your login session expired. Please login again.');
      } else if (status === 404) {
        setPhotoError('Photo not found for this delivery.');
      } else {
        setPhotoError('Could not open photo. Please try again.');
      }
    } finally {
      setLoadingPhotoId(null);
    }
  }

  return (
    <div className="map-page">
      <PageHeader
        eyebrow="Field activity"
        title="Delivery Map"
        subtitle="Every flyer delivery plotted from the rep's GPS fix. Filter by flyer, date and response, click a stop to see visit details and the proof photo, and toggle the route line to trace the rep's path."
      />

      <div className="map-stats">
        <div className="stat-card">
          <span>Deliveries</span>
          <strong>{stats.total}</strong>
        </div>

        <div className="stat-card" style={{ ['--stat-accent' as any]: '#0891b2' }}>
          <span>With GPS</span>
          <strong>{stats.withGps}</strong>
        </div>

        <div className="stat-card" style={{ ['--stat-accent' as any]: '#7c3aed' }}>
          <span>With photo</span>
          <strong>{stats.withPhotos}</strong>
        </div>

        <div className="stat-card" style={{ ['--stat-accent' as any]: '#ea580c' }}>
          <span>Follow-ups</span>
          <strong>{stats.followUps}</strong>
        </div>
      </div>

      <section className="map-filters card">
        <label>
          <span>Flyer</span>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">All flyers</option>
            {campaigns.map((campaign) => (
              <option key={campaign.CampaignId} value={campaign.CampaignId}>
                {campaign.CampaignName}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>From date</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>

        <label>
          <span>To date</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={responseStatus}
            onChange={(e) => setResponseStatus(e.target.value)}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="route-toggle">
          <input
            type="checkbox"
            checked={showRoute}
            onChange={(e) => setShowRoute(e.target.checked)}
          />
          <span>Show route</span>
        </label>
      </section>

      {error ? <div className="map-error card">{error}</div> : null}
      {photoError ? <div className="map-error card">{photoError}</div> : null}

      <section className="map-layout">
        <aside className="map-sidebar card">
          <div className="section-title-row">
            <div>
              <h2>Delivery stops</h2>
              <p>{deliveries.length} visit{deliveries.length === 1 ? '' : 's'} · newest first</p>
            </div>
          </div>

          {loading ? <p className="muted-text">Loading deliveries...</p> : null}

          {!loading && deliveries.length === 0 ? (
            <p className="muted-text">No deliveries found for these filters.</p>
          ) : null}

          <div className="delivery-list">
            {[...deliveries].reverse().map((delivery, index) => {
              const active = delivery.DeliveryId === selectedId;

              return (
                <button
                  key={delivery.DeliveryId}
                  type="button"
                  className={`delivery-item${
                    active ? ' delivery-item-active' : ''
                  }`}
                  onClick={() => setSelectedId(delivery.DeliveryId)}
                >
                  <span
                    className="delivery-badge"
                    style={{
                      backgroundColor: statusColor(delivery.ResponseStatus)
                    }}
                  >
                    {deliveries.length - index}
                  </span>

                  <span className="delivery-item-body">
                    <strong>{delivery.DoctorName || 'Unknown doctor'}</strong>

                    <small>
                      {delivery.ClinicName ||
                        delivery.DoctorAddressCity ||
                        'No clinic'}
                    </small>

                    <small>
                      {formatSubmittedAt(delivery.SubmittedAt)} ·{' '}
                      {delivery.ResponseStatus || 'No status'}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="map-panel card">
          <DeliveryTraceMap
            deliveries={deliveries}
            selectedId={selectedId}
            showRoute={showRoute}
            onSelect={(delivery) => setSelectedId(delivery.DeliveryId)}
          />
        </main>
      </section>

      {selected ? (
        <section className="map-detail card">
          <div className="detail-header">
            <div>
              <div className="eyebrow">Selected delivery</div>

              <h2>{selected.DoctorName || 'Unknown doctor'}</h2>

              <p>{selected.ClinicName || 'No clinic name recorded'}</p>

              <p className="detail-address">
                {[
                  selected.DoctorAddressStreet,
                  selected.DoctorAddressCity,
                  selected.DoctorAddressState,
                  selected.DoctorAddressZip
                ]
                  .filter(Boolean)
                  .join(', ') || 'No address recorded'}
              </p>
            </div>

            <span
              className="status-pill"
              style={{
                borderColor: statusColor(selected.ResponseStatus),
                color: statusColor(selected.ResponseStatus)
              }}
            >
              {selected.ResponseStatus || 'No status'}
            </span>
          </div>

          <div className="detail-grid">
            <div>
              <span>Flyer</span>
              <strong>{selected.CampaignName || '-'}</strong>
            </div>

            <div>
              <span>Rep</span>
              <strong>{selected.StaffName || '-'}</strong>
            </div>

            <div>
              <span>Person met</span>
              <strong>{selected.PersonMet || '-'}</strong>
            </div>

            <div>
              <span>Submitted</span>
              <strong>{formatSubmittedAt(selected.SubmittedAt)}</strong>
            </div>

            <div>
              <span>GPS accuracy</span>
              <strong>
                {selected.GpsAccuracyMeters
                  ? `${selected.GpsAccuracyMeters}m`
                  : '-'}
              </strong>
            </div>

            <div>
              <span>Flyer delivered</span>
              <strong>{selected.FlyerDelivered ? 'Yes' : 'No'}</strong>
            </div>

            <div>
              <span>Follow up</span>
              <strong>{selected.FollowUpRequired ? 'Yes' : 'No'}</strong>
            </div>

            <div>
              <span>Photo</span>
              <strong>{selected.HasPhoto ? 'Available' : 'No photo'}</strong>
            </div>
          </div>

          {selected.Notes ? (
            <p className="detail-notes">
              <strong>Notes:</strong> {selected.Notes}
            </p>
          ) : null}

          <div className="detail-actions">
            {selected.HasPhoto ? (
              <button
                type="button"
                className="primary-action"
                onClick={() => viewPhoto(selected.DeliveryId)}
                disabled={loadingPhotoId === selected.DeliveryId}
              >
                {loadingPhotoId === selected.DeliveryId
                  ? 'Opening photo...'
                  : 'View delivery photo'}
              </button>
            ) : (
              <span className="disabled-action">No photo attached</span>
            )}

            <a
              className="secondary-action"
              href={`https://www.google.com/maps?q=${selected.Latitude},${selected.Longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps
            </a>
          </div>
        </section>
      ) : null}

      <section className="map-legend card">
        <span>
          <i style={{ background: '#16a34a' }} /> Accepted / left with staff
        </span>

        <span>
          <i style={{ background: '#2563eb' }} /> Interested
        </span>

        <span>
          <i style={{ background: '#ea580c' }} /> Follow up / unavailable
        </span>

        <span>
          <i style={{ background: '#dc2626' }} /> Declined / not interested
        </span>

        <span>
          <i style={{ background: '#64748b' }} /> Other
        </span>
      </section>
    </div>
  );
}