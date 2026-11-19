'use client';

import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getRouteStopCoords, MapRouteStop, routeStopStatusColor } from '../types/routeReporting';

type Props = {
  stops: MapRouteStop[];
  selectedId: number | null;
  showRoute: boolean;
  onSelect: (stop: MapRouteStop) => void;
};

function FitBounds({ stops }: { stops: MapRouteStop[] }) {
  const map = useMap();
  useEffect(() => {
    const points = stops
      .map(getRouteStopCoords)
      .filter((point): point is { lat: number; lng: number } => Boolean(point))
      .map((point) => [point.lat, point.lng] as [number, number]);
    if (!points.length) {
      map.setView([27.8428, -82.6995], 10);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { padding: [40, 40] });
  }, [stops, map]);
  return null;
}

function FocusSelected({ stop }: { stop: MapRouteStop | null }) {
  const map = useMap();
  useEffect(() => {
    if (!stop) return;
    const coords = getRouteStopCoords(stop);
    if (!coords) return;
    map.flyTo([coords.lat, coords.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [stop, map]);
  return null;
}

export default function RouteStopsMap({ stops, selectedId, showRoute, onSelect }: Props) {
  const plotted = useMemo(
    () => stops.filter((stop) => Boolean(getRouteStopCoords(stop))),
    [stops],
  );

  const routePoints = useMemo(
    () =>
      plotted
        .map(getRouteStopCoords)
        .filter((point): point is { lat: number; lng: number } => Boolean(point))
        .map((point) => [point.lat, point.lng] as [number, number]),
    [plotted],
  );

  const selected = plotted.find((stop) => stop.RouteStopId === selectedId) || null;
  const defaultCenter: [number, number] = routePoints[0] || [27.8428, -82.6995];

  return (
    <MapContainer center={defaultCenter} zoom={10} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds stops={plotted} />
      <FocusSelected stop={selected} />

      {showRoute && routePoints.length > 1 && (
        <Polyline positions={routePoints} pathOptions={{ color: '#0f766e', weight: 3, opacity: 0.75, dashArray: '6 8' }} />
      )}

      {plotted.map((stop) => {
        const coords = getRouteStopCoords(stop);
        if (!coords) return null;
        const color = routeStopStatusColor(stop.StopStatus);
        const isSelected = stop.RouteStopId === selectedId;
        return (
          <CircleMarker
            key={stop.RouteStopId}
            center={[coords.lat, coords.lng]}
            radius={isSelected ? 11 : 8}
            pathOptions={{
              color: isSelected ? '#111827' : color,
              weight: isSelected ? 3 : 2,
              fillColor: color,
              fillOpacity: 0.9,
            }}
            eventHandlers={{ click: () => onSelect(stop) }}
          >
            <Popup>
              <strong>{stop.StopLabel || 'Route stop'}</strong>
              <br />
              #{stop.StopOrder} · {stop.StopStatus}
              <br />
              Flyer: {stop.AssignedFlyerName || '—'}
              <br />
              {stop.DistributorName || 'Distributor'}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
