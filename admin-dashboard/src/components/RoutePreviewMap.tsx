'use client';

import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export type RouteMapData = {
  start: {
    label: string;
    address?: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  stops: Array<{
    routeStopId: number;
    stopOrder: number;
    label?: string | null;
    address?: string | null;
    latitude: number | null;
    longitude: number | null;
    assignedFlyerName?: string | null;
    targetType?: string | null;
    status?: string | null;
  }>;
};

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) {
      map.setView([39.8283, -98.5795], 4);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { padding: [40, 40] });
  }, [points, map]);

  return null;
}

export default function RoutePreviewMap({ mapData }: { mapData: RouteMapData | null }) {
  const points = useMemo(() => {
    if (!mapData) return [] as Array<[number, number]>;
    const list: Array<[number, number]> = [];
    if (mapData.start.latitude != null && mapData.start.longitude != null) {
      list.push([mapData.start.latitude, mapData.start.longitude]);
    }
    for (const stop of mapData.stops) {
      if (stop.latitude != null && stop.longitude != null) {
        list.push([stop.latitude, stop.longitude]);
      }
    }
    return list;
  }, [mapData]);

  const routeLine = useMemo(() => points.slice(), [points]);
  const defaultCenter: [number, number] = points[0] || [27.8428, -82.6995];

  if (!mapData) {
    return <div className="map-loading"><span>Select a route to preview map.</span></div>;
  }

  return (
    <MapContainer center={defaultCenter} zoom={11} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />

      {mapData.start.latitude != null && mapData.start.longitude != null ? (
        <CircleMarker
          center={[mapData.start.latitude, mapData.start.longitude]}
          radius={10}
          pathOptions={{ color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.9 }}
        >
          <Popup>
            <strong>{mapData.start.label}</strong>
            <br />
            {mapData.start.address || 'Start location'}
          </Popup>
        </CircleMarker>
      ) : null}

      {mapData.stops.map((stop) => {
        if (stop.latitude == null || stop.longitude == null) return null;
        return (
          <CircleMarker
            key={stop.routeStopId}
            center={[stop.latitude, stop.longitude]}
            radius={8}
            pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.85 }}
          >
            <Popup>
              <strong>#{stop.stopOrder} {stop.label || 'Stop'}</strong>
              <br />
              {stop.assignedFlyerName || 'Flyer'}
              <br />
              {stop.address || 'Address pending'}
            </Popup>
          </CircleMarker>
        );
      })}

      {routeLine.length > 1 ? <Polyline positions={routeLine} pathOptions={{ color: '#64748b', weight: 3, dashArray: '6 8' }} /> : null}
    </MapContainer>
  );
}
