'use client';

import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getDeliveryCoords, MapDelivery, statusColor } from '../types/delivery';

type Props = {
  deliveries: MapDelivery[];
  selectedId: number | null;
  showRoute: boolean;
  onSelect: (delivery: MapDelivery) => void;
};

function FitBounds({ deliveries }: { deliveries: MapDelivery[] }) {
  const map = useMap();

  useEffect(() => {
    const points = deliveries
      .map(getDeliveryCoords)
      .filter((point): point is { lat: number; lng: number } => Boolean(point))
      .map((point) => [point.lat, point.lng] as [number, number]);

    if (points.length === 0) {
      map.setView([39.8283, -98.5795], 4);
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }

    map.fitBounds(points, { padding: [40, 40] });
  }, [deliveries, map]);

  return null;
}

function FocusSelected({ delivery }: { delivery: MapDelivery | null }) {
  const map = useMap();

  useEffect(() => {
    if (!delivery) return;
    const coords = getDeliveryCoords(delivery);
    if (!coords) return;
    map.flyTo([coords.lat, coords.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [delivery, map]);

  return null;
}

export default function DeliveryTraceMap({ deliveries, selectedId, showRoute, onSelect }: Props) {
  const plotted = useMemo(
    () => deliveries.filter((delivery) => Boolean(getDeliveryCoords(delivery))),
    [deliveries]
  );

  const routePoints = useMemo(
    () =>
      plotted
        .map(getDeliveryCoords)
        .filter((point): point is { lat: number; lng: number } => Boolean(point))
        .map((point) => [point.lat, point.lng] as [number, number]),
    [plotted]
  );

  const selected = plotted.find((delivery) => delivery.DeliveryId === selectedId) || null;
  const defaultCenter: [number, number] = routePoints[0] || [39.8283, -98.5795];

  return (
    <MapContainer center={defaultCenter} zoom={10} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds deliveries={plotted} />
      <FocusSelected delivery={selected} />

      {showRoute && routePoints.length > 1 && (
        <Polyline positions={routePoints} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.7, dashArray: '8 8' }} />
      )}

      {plotted.map((delivery, index) => {
        const coords = getDeliveryCoords(delivery);
        if (!coords) return null;
        const color = statusColor(delivery.ResponseStatus);
        const isSelected = delivery.DeliveryId === selectedId;

        return (
          <CircleMarker
            key={delivery.DeliveryId}
            center={[coords.lat, coords.lng]}
            radius={isSelected ? 11 : 8}
            pathOptions={{
              color: isSelected ? '#111827' : color,
              weight: isSelected ? 3 : 2,
              fillColor: color,
              fillOpacity: 0.9
            }}
            eventHandlers={{ click: () => onSelect(delivery) }}
          >
            <Popup>
              <strong>{delivery.DoctorName || 'Unknown doctor'}</strong>
              <br />
              {delivery.ClinicName || 'No clinic name'}
              <br />
              Stop #{index + 1} · {delivery.ResponseStatus || 'No status'}
              <br />
              {delivery.StaffName || 'Unknown staff'}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
