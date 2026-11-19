'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Icons cached per location key — stable identity across filter/reorder updates.
const iconCacheByKey = new Map<string, L.DivIcon>();
function iconForKey(key: string): L.DivIcon {
  const cached = iconCacheByKey.get(key);
  if (cached) return cached;
  const n = iconCacheByKey.size + 1;
  const size = 26;
  const icon = L.divIcon({
    className: 'rp-numbered-marker',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#3b82f6;border:2px solid #1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${n}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
  iconCacheByKey.set(key, icon);
  return icon;
}

export type CoveragePoint = {
  key: string;
  lat: number;
  lng: number;
  label: string;
  address?: string | null;
  phone?: string | null;
  doctorCount: number;
  doctors: string[];
};

export type MapCenter = { lat: number; lng: number } | null;

type Props = {
  points: CoveragePoint[];
  center?: MapCenter;
  radiusMiles?: number | null;
  selectedKey?: string | null;
  visible?: boolean;
};

const ST_PETE: [number, number] = [27.8428, -82.6995];
const MILES_TO_METERS = 1609.344;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function popupHtml(p: CoveragePoint): string {
  const doctors = p.doctors.slice(0, 6).join(', ');
  const more = p.doctors.length > 6 ? ` +${p.doctors.length - 6} more` : '';
  const phone = p.phone ? `📞 ${escapeHtml(p.phone)}<br/>` : '';
  const docList = p.doctors.length
    ? `<br/><small>${escapeHtml(doctors)}${escapeHtml(more)}</small>`
    : '';
  return [
    `<strong>${escapeHtml(p.label)}</strong>`,
    escapeHtml(p.address || '—'),
    phone,
    `${p.doctorCount} doctor${p.doctorCount === 1 ? '' : 's'}`,
    docList,
  ].filter(Boolean).join('<br/>');
}

function circleExtremes(center: { lat: number; lng: number }, radiusMiles: number): [number, number][] {
  const dLat = radiusMiles / 69.0;
  const dLng = radiusMiles / (69.0 * Math.cos((center.lat * Math.PI) / 180) || 1);
  return [
    [center.lat + dLat, center.lng],
    [center.lat - dLat, center.lng],
    [center.lat, center.lng + dLng],
    [center.lat, center.lng - dLng],
  ];
}

function isMapAlive(map: L.Map): boolean {
  return Boolean(map.getContainer()?.isConnected);
}

/**
 * Imperative Leaflet layers — avoids react-leaflet Marker/Popup reconciliation
 * races that throw "Failed to execute 'removeChild' on 'Node'".
 */
function MapLayers({
  points,
  center,
  radiusMiles,
  selectedKey,
  visible,
}: Required<Pick<Props, 'points'>> & Pick<Props, 'center' | 'radiusMiles' | 'selectedKey' | 'visible'>) {
  const map = useMap();
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const territoryCircleRef = useRef<L.Circle | null>(null);
  const centerMarkerRef = useRef<L.CircleMarker | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      if (isMapAlive(map)) map.invalidateSize();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [visible, map]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!isMapAlive(map)) return;
      map.closePopup();
      const coords = points.map((p) => [p.lat, p.lng] as [number, number]);
      if (center && radiusMiles) {
        map.fitBounds([...coords, ...circleExtremes(center, radiusMiles)], { padding: [30, 30] });
        return;
      }
      if (!coords.length) {
        map.setView(ST_PETE, 9);
        return;
      }
      if (coords.length === 1) {
        map.setView(coords[0], 12);
        return;
      }
      map.fitBounds(coords, { padding: [40, 40] });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [points, center, radiusMiles, map]);

  useEffect(() => {
    if (!isMapAlive(map)) return;

    if (center && radiusMiles) {
      const circleCenter: L.LatLngExpression = [center.lat, center.lng];
      if (!territoryCircleRef.current) {
        territoryCircleRef.current = L.circle(circleCenter, {
          radius: radiusMiles * MILES_TO_METERS,
          color: '#2563eb',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
        }).addTo(map);
      } else {
        territoryCircleRef.current.setLatLng(circleCenter);
        territoryCircleRef.current.setRadius(radiusMiles * MILES_TO_METERS);
      }

      if (!centerMarkerRef.current) {
        centerMarkerRef.current = L.circleMarker(circleCenter, {
          radius: 7,
          color: '#fff',
          weight: 2,
          fillColor: '#dc2626',
          fillOpacity: 1,
        })
          .bindPopup(`<strong>Center</strong><br/>${radiusMiles} mile radius`)
          .addTo(map);
      } else {
        centerMarkerRef.current.setLatLng(circleCenter);
      }
    } else {
      if (territoryCircleRef.current) {
        map.removeLayer(territoryCircleRef.current);
        territoryCircleRef.current = null;
      }
      if (centerMarkerRef.current) {
        map.removeLayer(centerMarkerRef.current);
        centerMarkerRef.current = null;
      }
    }
  }, [center, radiusMiles, map]);

  useEffect(() => {
    if (!isMapAlive(map)) return;

    const live = markersRef.current;
    const nextKeys = new Set(points.map((p) => p.key));

    for (const [key, marker] of live) {
      if (!nextKeys.has(key)) {
        map.removeLayer(marker);
        live.delete(key);
      }
    }

    for (const p of points) {
      const latLng: L.LatLngExpression = [p.lat, p.lng];
      const html = popupHtml(p);
      const existing = live.get(p.key);
      if (existing) {
        existing.setLatLng(latLng);
        existing.setIcon(iconForKey(p.key));
        existing.setPopupContent(html);
      } else {
        const marker = L.marker(latLng, { icon: iconForKey(p.key) })
          .bindPopup(html)
          .addTo(map);
        live.set(p.key, marker);
      }
    }
  }, [points, map]);

  useEffect(() => {
    if (focusTimerRef.current != null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (!selectedKey || !isMapAlive(map)) return;

    const marker = markersRef.current.get(selectedKey);
    if (!marker || !map.hasLayer(marker)) return;

    map.closePopup();
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.5 });
    focusTimerRef.current = window.setTimeout(() => {
      if (isMapAlive(map) && map.hasLayer(marker)) marker.openPopup();
    }, 520);

    return () => {
      if (focusTimerRef.current != null) window.clearTimeout(focusTimerRef.current);
      if (isMapAlive(map)) map.closePopup();
    };
  }, [selectedKey, map]);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current != null) window.clearTimeout(focusTimerRef.current);
      if (!isMapAlive(map)) return;
      map.closePopup();
      for (const marker of markersRef.current.values()) map.removeLayer(marker);
      markersRef.current.clear();
      if (territoryCircleRef.current) map.removeLayer(territoryCircleRef.current);
      if (centerMarkerRef.current) map.removeLayer(centerMarkerRef.current);
      territoryCircleRef.current = null;
      centerMarkerRef.current = null;
    };
  }, [map]);

  return null;
}

export default function RoutePlannerCoverageMap({
  points,
  center,
  radiusMiles,
  selectedKey,
  visible = true,
}: Props) {
  const plotted = useMemo(
    () => points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [points],
  );

  const initialCenter: [number, number] = center
    ? [center.lat, center.lng]
    : plotted[0]
      ? [plotted[0].lat, plotted[0].lng]
      : ST_PETE;

  return (
    <MapContainer center={initialCenter} zoom={9} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapLayers
        points={plotted}
        center={center}
        radiusMiles={radiusMiles}
        selectedKey={selectedKey}
        visible={visible}
      />
    </MapContainer>
  );
}
