'use client';

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type PlannerMapAssignment = {
  AssignmentId: number;
  TargetName: string;
  TargetType: string;
  CampaignName: string;
  FlyerTitle?: string;
  Specialty?: string;
  AddressStreet?: string | null;
  AddressCity?: string;
  AddressState?: string;
  AddressZip?: string | null;
  Latitude?: number | string | null;
  Longitude?: number | string | null;
  ApprovalStatus?: string;
  AssignmentStatus?: string;
  StaffName?: string;
};

export type PlannerMapZone = {
  id: string;
  name: string;
  color: string;
  assignmentIds: number[];
  staffUserId: string;
  hours: string;
  estimatedMiles: number;
  estimatedMinutes: number;
};

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function addressLine(assignment: PlannerMapAssignment) {
  const cityState = [assignment.AddressCity, assignment.AddressState].filter(Boolean).join(', ');
  return [assignment.AddressStreet, cityState || undefined, assignment.AddressZip || undefined]
    .filter(Boolean)
    .join(' · ') || 'Address pending';
}

function zonePolygon(points: Array<[number, number]>): Array<[number, number]> | null {
  if (!points.length) return null;

  let minLat = points[0][0];
  let maxLat = points[0][0];
  let minLng = points[0][1];
  let maxLng = points[0][1];

  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  const latPad = Math.max((maxLat - minLat) * 0.25, 0.004);
  const lngPad = Math.max((maxLng - minLng) * 0.25, 0.004);

  return [
    [minLat - latPad, minLng - lngPad],
    [minLat - latPad, maxLng + lngPad],
    [maxLat + latPad, maxLng + lngPad],
    [maxLat + latPad, minLng - lngPad]
  ];
}

export default function WorkflowRoutePlannerMap({
  assignments,
  zones,
  selectedAssignmentIds,
  activeZoneId,
  onToggleAssignment,
  onSelectZone
}: {
  assignments: PlannerMapAssignment[];
  zones: PlannerMapZone[];
  selectedAssignmentIds: number[];
  activeZoneId: string | null;
  onToggleAssignment: (assignmentId: number) => void;
  onSelectZone: (zoneId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const assignmentById = useMemo(() => {
    const map = new Map<number, PlannerMapAssignment>();
    for (const assignment of assignments) map.set(assignment.AssignmentId, assignment);
    return map;
  }, [assignments]);

  const zoneByAssignmentId = useMemo(() => {
    const map = new Map<number, PlannerMapZone>();
    for (const zone of zones) {
      for (const assignmentId of zone.assignmentIds) map.set(assignmentId, zone);
    }
    return map;
  }, [zones]);

  const selectedSet = useMemo(() => new Set(selectedAssignmentIds), [selectedAssignmentIds]);

  const points = useMemo(() => {
    return assignments
      .map((assignment) => {
        const lat = numberOrNull(assignment.Latitude);
        const lng = numberOrNull(assignment.Longitude);
        return lat !== null && lng !== null ? [lat, lng] as [number, number] : null;
      })
      .filter(Boolean) as Array<[number, number]>;
  }, [assignments]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    container.innerHTML = '';

    const map = L.map(container, { scrollWheelZoom: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const bounds: L.LatLngExpression[] = [];

    for (const zone of zones) {
      const zonePoints = zone.assignmentIds
        .map((id) => assignmentById.get(id))
        .map((assignment) => {
          if (!assignment) return null;
          const lat = numberOrNull(assignment.Latitude);
          const lng = numberOrNull(assignment.Longitude);
          return lat !== null && lng !== null ? [lat, lng] as [number, number] : null;
        })
        .filter(Boolean) as Array<[number, number]>;
      const polygon = zonePolygon(zonePoints);
      if (!polygon) continue;

      const zoneLayer = L.polygon(polygon, {
        color: zone.color,
        fillColor: zone.color,
        fillOpacity: activeZoneId === zone.id ? 0.2 : 0.11,
        weight: activeZoneId === zone.id ? 4 : 2
      })
        .addTo(map)
        .bindPopup(`
          <strong>${escapeHtml(zone.name)}</strong><br />
          ${zone.assignmentIds.length} stop(s)<br />
          Est. ${Math.round(zone.estimatedMinutes)} min · ${zone.estimatedMiles.toFixed(1)} mi
        `);

      zoneLayer.on('click', () => onSelectZone(zone.id));
      polygon.forEach((point) => bounds.push(point));
    }

    for (const assignment of assignments) {
      const lat = numberOrNull(assignment.Latitude);
      const lng = numberOrNull(assignment.Longitude);
      if (lat === null || lng === null) continue;

      const zone = zoneByAssignmentId.get(assignment.AssignmentId);
      const isSelected = selectedSet.has(assignment.AssignmentId);
      const color = isSelected ? '#111827' : zone?.color || '#2563eb';
      const fillColor = isSelected ? '#facc15' : zone?.color || '#3b82f6';

      const marker = L.circleMarker([lat, lng], {
        radius: isSelected ? 9 : 7,
        color,
        fillColor,
        fillOpacity: 0.92,
        weight: isSelected ? 3 : 2
      })
        .addTo(map)
        .bindPopup(`
          <strong>${escapeHtml(assignment.TargetName)}</strong><br />
          ${escapeHtml(assignment.TargetType)} · ${escapeHtml(assignment.FlyerTitle || assignment.CampaignName)}<br />
          Specialty: ${escapeHtml(assignment.Specialty || 'Unknown')}<br />
          ${escapeHtml(addressLine(assignment))}<br />
          ${zone ? `Zone: ${escapeHtml(zone.name)}` : 'Unassigned to zone'}
          ${assignment.StaffName ? `<br />Assigned: ${escapeHtml(assignment.StaffName)}` : ''}
        `);

      marker.on('click', () => onToggleAssignment(assignment.AssignmentId));
      bounds.push([lat, lng]);
    }

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else {
      map.setView([27.8428, -82.6995], 11);
    }

    window.setTimeout(() => map.invalidateSize(), 50);

    return () => {
      map.remove();
      mapRef.current = null;
      container.innerHTML = '';
    };
  }, [assignments, zones, selectedSet, activeZoneId, assignmentById, zoneByAssignmentId, onToggleAssignment, onSelectZone]);

  return <div ref={containerRef} className="workflow-route-planner-leaflet" />;
}
