'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, API_BASE_URL } from '../../src/services/api';
import './workflow.css';

// ─── Types ─────────────────────────────────────────────────────────────────

type Campaign = { CampaignId: number; CampaignName: string; FlyerTitle?: string | null };
type Staff    = { ID: number; User_Id?: string | null; User_FirstName?: string | null; User_LastName?: string | null; User_Email?: string | null };
type CapacityType = 'full_time' | 'part_time' | 'custom';

type DoctorTypeOption = { value: string; label: string; count?: number };

// Live build progress streamed from the backend optimize pipeline.
type RoutePhase = 'matching' | 'geocode' | 'matrix' | 'solve';
type RouteProgress = {
  phase: RoutePhase;
  done: number;
  total: number;
  etaSec: number | null;  // estimated seconds left in this phase (null = unknown)
  etaAt: number;          // ms timestamp etaSec was computed (for countdown)
};

type PreviewDoctor = {
  doctorId?: number | null;
  targetName: string;
  npiNumber?: string | null;
  specialty?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceMiles?: number | null;
  zoneKey?: string;
};

// A flyer/campaign that must be dropped at a location.
type Flyer = { campaignId: number; campaignName: string };
// A deduped doctor carrying every flyer (across campaigns) destined for it.
type MergedDoctor = PreviewDoctor & { flyers: Flyer[] };
// One "add another campaign" row: a campaign + the doctor types it targets.
type CampaignEntry = { id: string; campaignId: string; doctorTypes: string[] };

type Zone = {
  zoneId: string;
  zoneName: string;
  radiusBand: string;
  startMiles: number;
  endMiles: number;
  doctorsCount: number;
  specialtyBreakdown: Record<string, number>;
  estimatedMinutes: number;
  estimatedHours: number;
  capacityStatus: 'fits' | 'over' | 'under';
  suggestedPeopleOrDays: number;
  doctors: PreviewDoctor[];
};

type PreviewResponse = {
  city: string;
  state: string;
  cityCenter: { latitude: number; longitude: number };
  filters: { capacityHours: number; capacityType: CapacityType };
  totals: { matchedDoctors: number; mappableDoctors: number; needsCoordinates: number; generatedZones: number };
  constants: {
    averageStopServiceMinutes: number;
    averageParkingBufferMinutes: number;
    denseZoneDriveMinutesPerStop: number;
    wideZoneDriveMinutesPerStop: number;
    zoneStartEndBufferMinutes: number;
  };
  doctors: PreviewDoctor[];
  needsCoordinates: PreviewDoctor[];
  zones: Zone[];
};

// ─── Optimized route (data_processing_node pipeline) ─────────────────────────

type RouteStopDoctor = {
  doctorId: number | null;
  targetName: string | null;
  npiNumber: string | null;
  specialty: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
};

type RouteStop = {
  stopOrder: number;
  arrive: string;
  depart: string;
  driveMinFromPrev: number;
  serviceMin: number;
  addressStreet: string | null;
  city: string | null;
  zip: string | null;
  numDoctors: number;
  doctorIds: (number | null)[];
  doctorNames: string;
  phones: string;
  specialties: string[];
  latitude: number;
  longitude: number;
  doctors: RouteStopDoctor[];
};

// A zone is a contiguous segment of the optimized route assigned to one person.
type RouteZone = {
  zoneId: string;
  name: string;
  color: string;
  stops: RouteStop[];
  doctorsCount: number;
  estimatedMinutes: number;
  estimatedHours: number;
};

type UncoveredDoctor = {
  reason: 'not_enough_capacity' | 'could_not_geocode';
  doctorId: number | null;
  targetName: string;
  addressStreet: string | null;
  city: string | null;
  zip: string | null;
  specialty: string | null;
};

type RoutePlan = {
  engine: string;
  travelEngineRequested: string;
  params: { hours: number; pitStopMinutes: number; startTime: string };
  totals: {
    inputDoctors: number;
    routableLocations: number;
    routedLocations: number;
    routedDoctors: number;
    ungeocodedDoctors: number;
    droppedLocations: number;
  };
  summary: {
    shiftHours: number;
    locations: number;
    doctors: number;
    driveMin: number;
    serviceMin: number;
    totalMin: number;
    utilizationPct: number;
    gmapsUrl: string;
  };
  stops: RouteStop[];
  uncovered: UncoveredDoctor[];
  routedDoctorIds: (number | null)[];
};

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const BASE_OPTIONS: DoctorTypeOption[] = [{ value: 'Any', label: 'Any doctor type' }];
const today = new Date().toISOString().slice(0, 10);

const ZONE_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#be185d', '#65a30d', '#ea580c', '#6d28d9'
];

// ─── Pure helpers ────────────────────────────────────────────────────────────

function str(v: unknown) { return String(v ?? '').trim(); }

// Pre-fill an editable, mostly-unique alphanumeric route name e.g. "STP-L9F2K".
function generateRouteName(label?: string) {
  const prefix = String(label || 'RT')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase() || 'RT';
  const suffix = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return `${prefix}-${suffix}`;
}

function keyOf(doctorId: number | null | undefined, name: unknown, zip: unknown) {
  return `${doctorId ?? 'x'}-${str(name)}-${str(zip)}`;
}

function doctorKey(d: PreviewDoctor) {
  return keyOf(d.doctorId, d.targetName, d.addressZip);
}

let entrySeq = 0;
function newCampaignEntry(campaignId = ''): CampaignEntry {
  entrySeq += 1;
  return { id: `ce_${Date.now()}_${entrySeq}`, campaignId, doctorTypes: ['Any'] };
}

function specialty(d: PreviewDoctor) { return str(d.specialty) || 'Unknown'; }

function staffName(s: Staff) {
  const n = `${s.User_FirstName ?? ''} ${s.User_LastName ?? ''}`.trim();
  return n || str(s.User_Email) || str(s.User_Id) || `User ${s.ID}`;
}

function campaignName(c: Campaign | undefined) {
  if (!c) return '';
  return str(c.FlyerTitle) || str(c.CampaignName);
}

function statusBadge(status: Zone['capacityStatus']) {
  if (status === 'over')  return { label: 'Over capacity',   color: '#fef2f2', border: '#fecaca', text: '#991b1b' };
  if (status === 'under') return { label: 'Under capacity',  color: '#fff7ed', border: '#fed7aa', text: '#9a3412' };
  return                          { label: 'Fits day',       color: '#f0fdf4', border: '#bbf7d0', text: '#166534' };
}

function zoneColor(index: number) { return ZONE_COLORS[index % ZONE_COLORS.length]; }

function topSpecialties(breakdown: Record<string, number>, max = 3) {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

function estimateMinutes(
  count: number,
  endMiles: number,
  constants: PreviewResponse['constants']
) {
  const drive = endMiles <= 15
    ? constants.denseZoneDriveMinutesPerStop
    : constants.wideZoneDriveMinutesPerStop;
  return count * (constants.averageStopServiceMinutes + constants.averageParkingBufferMinutes + drive)
    + constants.zoneStartEndBufferMinutes;
}

// ─── SVG Map ────────────────────────────────────────────────────────────────

const MAP_W = 700;
const MAP_H = 460;
const MAX_PINS = 1000;

type MapPin = {
  x: number; y: number;
  doctor: PreviewDoctor;
  zoneIndex: number;
  color: string;
};

type MapState = {
  pins: MapPin[];
  rings: { cx: number; cy: number; r: number; color: string; label: string }[];
  center: { x: number; y: number };
  sampled: boolean;
  total: number;
};

function buildMapState(
  zones: Zone[],
  cityCenter: { latitude: number; longitude: number }
): MapState {
  const allDocs = zones.flatMap((z, zi) => z.doctors.map((d) => ({ d, zi })));

  if (!allDocs.length) {
    return { pins: [], rings: [], center: { x: MAP_W / 2, y: MAP_H / 2 }, sampled: false, total: 0 };
  }

  const lats = allDocs.map((e) => e.d.latitude ?? cityCenter.latitude);
  const lngs = allDocs.map((e) => e.d.longitude ?? cityCenter.longitude);
  const minLat = Math.min(...lats, cityCenter.latitude);
  const maxLat = Math.max(...lats, cityCenter.latitude);
  const minLng = Math.min(...lngs, cityCenter.longitude);
  const maxLng = Math.max(...lngs, cityCenter.longitude);

  const pad = 36;
  const latRange = maxLat - minLat || 0.1;
  const lngRange = maxLng - minLng || 0.1;

  function project(lat: number, lng: number) {
    return {
      x: pad + ((lng - minLng) / lngRange) * (MAP_W - pad * 2),
      y: MAP_H - pad - ((lat - minLat) / latRange) * (MAP_H - pad * 2)
    };
  }

  const center = project(cityCenter.latitude, cityCenter.longitude);

  // rings: one per zone, radius based on outer mile bound projected to pixels
  const degreesPerMile = 1 / 69;
  const mileToPixels = ((MAP_H - pad * 2) / latRange) * degreesPerMile;

  const rings = zones.map((z, zi) => ({
    cx: center.x,
    cy: center.y,
    r: z.endMiles * mileToPixels,
    color: zoneColor(zi),
    label: z.zoneName
  }));

  const sampled = allDocs.length > MAX_PINS;
  const subset = sampled
    ? allDocs.filter((_, i) => i % Math.ceil(allDocs.length / MAX_PINS) === 0)
    : allDocs;

  const pins: MapPin[] = subset
    .filter((e) => e.d.latitude != null && e.d.longitude != null)
    .map((e) => {
      const { x, y } = project(e.d.latitude!, e.d.longitude!);
      return { x, y, doctor: e.d, zoneIndex: e.zi, color: zoneColor(e.zi) };
    });

  return { pins, rings, center, sampled, total: allDocs.length };
}

function GeoMap({
  zones,
  cityCenter,
  selectedZoneId,
  onPinClick
}: {
  zones: Zone[];
  cityCenter: { latitude: number; longitude: number };
  selectedZoneId: string;
  onPinClick: (doctor: PreviewDoctor) => void;
}) {
  const mapState = useMemo(() => buildMapState(zones, cityCenter), [zones, cityCenter]);

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{ background: '#f0f6ff', borderRadius: 10, border: '1px solid #dbe3ef', display: 'block' }}
      >
        {/* Zone radius rings — outermost first so they sit below */}
        {[...mapState.rings].reverse().map((ring, i) => (
          <circle
            key={i}
            cx={ring.cx}
            cy={ring.cy}
            r={ring.r}
            fill={ring.color + '18'}
            stroke={ring.color}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        ))}

        {/* Ring labels */}
        {mapState.rings.map((ring, i) => (
          <text
            key={i}
            x={ring.cx + ring.r - 4}
            y={ring.cy - 4}
            fill={ring.color}
            fontSize={10}
            textAnchor="end"
          >
            {ring.label}
          </text>
        ))}

        {/* Doctor pins */}
        {mapState.pins.map((pin, i) => {
          const zone = zones[pin.zoneIndex];
          const active = zone?.zoneId === selectedZoneId;
          return (
            <circle
              key={i}
              cx={pin.x}
              cy={pin.y}
              r={active ? 5 : 3.5}
              fill={pin.color}
              opacity={active ? 1 : 0.65}
              stroke="#fff"
              strokeWidth={active ? 1.5 : 0.8}
              style={{ cursor: 'pointer' }}
              onClick={() => onPinClick(pin.doctor)}
            />
          );
        })}

        {/* City center */}
        <circle cx={mapState.center.x} cy={mapState.center.y} r={8} fill="#0f172a" stroke="#fff" strokeWidth={2} />
        <text x={mapState.center.x + 11} y={mapState.center.y + 4} fill="#0f172a" fontSize={11} fontWeight="600">
          City center
        </text>
      </svg>

      {mapState.sampled && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
          Showing {mapState.pins.length.toLocaleString()} of {mapState.total.toLocaleString()} pins (sampled for performance).
        </p>
      )}
    </div>
  );
}

// ─── Doctor popup ────────────────────────────────────────────────────────────

function DoctorPopup({
  doctor,
  campaigns,
  flyerMap,
  onClose,
  onFlyerChange
}: {
  doctor: PreviewDoctor;
  campaigns: Campaign[];
  flyerMap: Record<string, number>;
  onClose: () => void;
  onFlyerChange: (key: string, campaignId: number) => void;
}) {
  const key = doctorKey(doctor);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 24, maxWidth: 420, width: '90vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{doctor.targetName}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>NPI: {str(doctor.npiNumber) || '—'}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', padding: 0 }}
          >✕</button>
        </div>
        <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#334155' }}>
          <div><strong>Type / Specialty:</strong> {specialty(doctor)}</div>
          <div><strong>Address:</strong> {str(doctor.addressStreet) || '—'}, {str(doctor.addressCity)}</div>
          <div><strong>Phone:</strong> {str(doctor.phone) || '—'}</div>
          {doctor.distanceMiles != null && <div><strong>Distance:</strong> {doctor.distanceMiles} mi from center</div>}
          <div><strong>Coordinates:</strong> {doctor.latitude != null ? `${doctor.latitude?.toFixed(4)}, ${doctor.longitude?.toFixed(4)}` : 'Unavailable'}</div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 13, color: '#334155' }}>
            Assigned flyer
            <select
              value={String(flyerMap[key] || '')}
              onChange={(e) => onFlyerChange(key, Number(e.target.value))}
              style={{ border: '1px solid #c9d6e8', borderRadius: 8, padding: '8px 10px', fontSize: 14 }}
            >
              <option value="">Select flyer</option>
              {campaigns.map((c) => <option key={c.CampaignId} value={c.CampaignId}>{campaignName(c)}</option>)}
            </select>
          </label>
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '9px', border: 'none',
            borderRadius: 8, background: '#2563eb', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600
          }}
        >Close</button>
      </div>
    </div>
  );
}

// ─── Built-in Leaflet map (loaded from CDN, no npm dependency) ───────────────

let leafletPromise: Promise<any> | null = null;

function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    // JS
    const existing = document.querySelector('script[data-leaflet]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(w.L));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.setAttribute('data-leaflet', '1');
    script.onload = () => resolve(w.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function RouteZoneMap({
  zones,
  selectedZoneId
}: {
  zones: RouteZone[];
  selectedZoneId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  // Init / draw whenever zones change.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { scrollWheelZoom: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(mapRef.current);
      }

      const map = mapRef.current;
      if (layerRef.current) { map.removeLayer(layerRef.current); }
      const group = L.layerGroup().addTo(map);
      layerRef.current = group;

      const allLatLngs: [number, number][] = [];

      zones.forEach((zone) => {
        const latlngs = zone.stops.map((s) => [s.latitude, s.longitude] as [number, number]);
        latlngs.forEach((ll) => allLatLngs.push(ll));

        if (latlngs.length > 1) {
          L.polyline(latlngs, { color: zone.color, weight: 3, opacity: 0.75 }).addTo(group);
        }

        zone.stops.forEach((s) => {
          const icon = L.divIcon({
            className: 'wf-pin-icon',
            html: `<div style="background:${zone.color};color:#fff;border-radius:50%;width:24px;height:24px;line-height:24px;text-align:center;font-weight:700;font-size:11px;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5)">${s.stopOrder}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });
          const docList = s.doctors
            .map((d) => `• ${str(d.targetName)}${d.specialty ? ` <span style="color:#64748b">(${str(d.specialty)})</span>` : ''}`)
            .join('<br/>');
          L.marker([s.latitude, s.longitude], { icon })
            .bindPopup(
              `<strong>Stop ${s.stopOrder} — ${zone.name}</strong><br/>` +
              `${str(s.addressStreet)}, ${str(s.city)} ${str(s.zip)}<br/>` +
              `<span style="color:#64748b">Arrive ${s.arrive} · depart ${s.depart} · ${s.numDoctors} doctor(s)</span>` +
              (docList ? `<hr style="margin:6px 0"/>${docList}` : '')
            )
            .addTo(group);
        });
      });

      if (allLatLngs.length) {
        map.fitBounds(allLatLngs, { padding: [30, 30], maxZoom: 14 });
      }
      // Map can render before its container has its final size.
      setTimeout(() => map.invalidateSize(), 50);
    }).catch(() => {/* leaflet failed to load; map stays blank */});

    return () => { cancelled = true; };
  }, [zones]);

  // Highlight selected zone by re-centering on it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const zone = zones.find((z) => z.zoneId === selectedZoneId);
    if (zone && zone.stops.length) {
      loadLeaflet().then(() => {
        const lls = zone.stops.map((s) => [s.latitude, s.longitude] as [number, number]);
        map.fitBounds(lls, { padding: [40, 40], maxZoom: 15 });
      });
    }
  }, [selectedZoneId, zones]);

  // Destroy map on unmount.
  useEffect(() => {
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height: 440, width: '100%', borderRadius: 10, border: '1px solid #dbe3ef', overflow: 'hidden', zIndex: 0 }}
    />
  );
}

// Split the ordered optimized route into N contiguous zones, balanced by the
// per-stop workload (drive + service minutes) so each person's day is similar.
function buildRouteZones(stops: RouteStop[], zoneCount: number): RouteZone[] {
  if (!stops.length) return [];
  const count = Math.max(1, Math.min(zoneCount, stops.length));
  const totalMin = stops.reduce((sum, s) => sum + s.driveMinFromPrev + s.serviceMin, 0);
  const target = totalMin / count;

  const groups: RouteStop[][] = [];
  let current: RouteStop[] = [];
  let acc = 0;
  for (const s of stops) {
    current.push(s);
    acc += s.driveMinFromPrev + s.serviceMin;
    if (groups.length < count - 1 && acc >= target) {
      groups.push(current);
      current = [];
      acc = 0;
    }
  }
  if (current.length) groups.push(current);
  // If balancing produced fewer groups than requested, leave as is.

  return groups.map((groupStops, i) => {
    const mins = groupStops.reduce((sum, s) => sum + s.driveMinFromPrev + s.serviceMin, 0);
    return {
      zoneId: `rzone_${i + 1}`,
      name: `Zone ${i + 1}`,
      color: zoneColor(i),
      stops: groupStops,
      doctorsCount: groupStops.reduce((sum, s) => sum + s.numDoctors, 0),
      estimatedMinutes: Math.round(mins * 10) / 10,
      estimatedHours: Math.round((mins / 60) * 10) / 10
    };
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState('');
  const [error, setError]       = useState('');
  const [message, setMessage]   = useState('');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [campaigns, setCampaigns]           = useState<Campaign[]>([]);
  const [staff, setStaff]                   = useState<Staff[]>([]);
  const [specialtyOpts, setSpecialtyOpts]   = useState<DoctorTypeOption[]>(BASE_OPTIONS);

  const [form, setForm] = useState({
    campaignId:   '',
    doctorType:   'Any',
    city:         'St. Petersburg',
    capacityType: 'full_time' as CapacityType,
    customHours:  '8',
    scheduledDate: today
  });

  const [preview, setPreview]                     = useState<PreviewResponse | null>(null);
  const [zones, setZones]                         = useState<Zone[]>([]);
  const [needsCoords, setNeedsCoords]             = useState<PreviewDoctor[]>([]);
  const [selectedZoneId, setSelectedZoneId]       = useState('');
  const [staffByZone, setStaffByZone]             = useState<Record<string, string>>({});
  const [doctorFlyers, setDoctorFlyers]           = useState<Record<string, number>>({});
  const [popupDoctor, setPopupDoctor]             = useState<PreviewDoctor | null>(null);

  const [previewSearch, setPreviewSearch] = useState('');
  const [previewPage, setPreviewPage]     = useState(1);
  const [zoneSearch, setZoneSearch]       = useState('');
  const [bulkAssign, setBulkAssign]       = useState({ specialty: 'All', campaignId: '' });

  // Optimized route (data_processing_node pipeline)
  const [routePlan, setRoutePlan]   = useState<RoutePlan | null>(null);
  const [routeOpts, setRouteOpts]   = useState({ pitStopMinutes: '10', travel: 'osrm' as 'osrm' | 'offline' });
  const [routeZoneCount, setRouteZoneCount]   = useState(3);
  const [selectedRouteZoneId, setSelectedRouteZoneId] = useState('');
  const [routeZonePerson, setRouteZonePerson] = useState<Record<string, string>>({});  // zoneId -> staffId
  const [routeZoneFlyer, setRouteZoneFlyer]   = useState<Record<string, string>>({});  // zoneId -> campaignId
  const [routeStopFlyer, setRouteStopFlyer]   = useState<Record<number, string>>({});  // stopOrder -> campaignId override
  const [routeName, setRouteName]             = useState('');                          // editable name for the saved route

  // Multi-campaign planning: one row per campaign, each with its own doctor types.
  // City, work capacity and scheduled date stay shared (in `form`).
  const [campaignEntries, setCampaignEntries] = useState<CampaignEntry[]>([newCampaignEntry()]);
  const [matchedCount, setMatchedCount]       = useState(0);                            // deduped doctors matched
  const [routeFlyerCount, setRouteFlyerCount] = useState(0);                            // total flyer drops in plan
  // doctorKey -> flyers to drop there, captured at optimize time so save can fan out.
  const doctorFlyersRef = useRef<Map<string, Flyer[]>>(new Map());

  // Live progress for the build button (streamed from the backend pipeline).
  const [routeProgress, setRouteProgress] = useState<RouteProgress | null>(null);
  const [nowTick, setNowTick]             = useState(0);          // 1s heartbeat for elapsed/ETA
  const routeStartRef = useRef(0);                                 // ms timestamp the build began
  const phaseTimingRef = useRef<{ phase: RoutePhase; at: number } | null>(null);

  // Tick once a second while a route is building so the elapsed time and ETA
  // keep counting even between progress events.
  useEffect(() => {
    if (busy !== 'route') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const selectedZone = zones.find((z) => z.zoneId === selectedZoneId) ?? null;

  const allPreviewDoctors = useMemo(
    () => preview ? [...preview.doctors, ...preview.needsCoordinates] : [],
    [preview]
  );

  const filteredPreview = useMemo(() => {
    const q = previewSearch.toUpperCase().trim();
    if (!q) return allPreviewDoctors;
    return allPreviewDoctors.filter((d) =>
      [d.targetName, specialty(d), d.addressCity, d.addressStreet, d.phone, d.npiNumber]
        .map((v) => str(v).toUpperCase())
        .join(' ')
        .includes(q)
    );
  }, [allPreviewDoctors, previewSearch]);

  const pageCount   = Math.max(1, Math.ceil(filteredPreview.length / PAGE_SIZE));
  const safePage    = Math.min(previewPage, pageCount);
  const previewRows = filteredPreview.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const zoneDoctors = useMemo(() => {
    if (!selectedZone) return [];
    const q = zoneSearch.toUpperCase().trim();
    if (!q) return selectedZone.doctors;
    return selectedZone.doctors.filter((d) =>
      [d.targetName, specialty(d), d.addressStreet, d.phone]
        .map((v) => str(v).toUpperCase())
        .join(' ')
        .includes(q)
    );
  }, [selectedZone, zoneSearch]);

  const zoneSpecialties = useMemo(() => {
    if (!selectedZone) return ['All'];
    return ['All', ...Array.from(new Set(selectedZone.doctors.map(specialty))).sort()];
  }, [selectedZone]);

  // Divide the optimized route into contiguous, workload-balanced zones.
  const routeZones = useMemo(
    () => routePlan ? buildRouteZones(routePlan.stops, routeZoneCount) : [],
    [routePlan, routeZoneCount]
  );

  const selectedRouteZone = routeZones.find((z) => z.zoneId === selectedRouteZoneId) ?? routeZones[0] ?? null;

  // The route is shown as one line on the map (no zone splitting).
  const routeMapZones = useMemo<RouteZone[]>(() => {
    if (!routePlan?.stops.length) return [];
    return [{
      zoneId: 'route',
      name: routeName || 'Route',
      color: '#2563eb',
      stops: routePlan.stops,
      doctorsCount: routePlan.summary.doctors,
      estimatedMinutes: routePlan.summary.totalMin,
      estimatedHours: Math.round((routePlan.summary.totalMin / 60) * 10) / 10
    }];
  }, [routePlan, routeName]);

  // Seed sensible defaults (first staff + campaign flyer) whenever zones change.
  useEffect(() => {
    if (!routeZones.length) return;
    const defaultStaff = staff[0]?.ID ? String(staff[0].ID) : '';
    const defaultFlyer = campaignEntries[0]?.campaignId || (campaigns[0]?.CampaignId ? String(campaigns[0].CampaignId) : '');
    setRouteZonePerson((prev) => {
      const next = { ...prev };
      routeZones.forEach((z) => { if (next[z.zoneId] === undefined) next[z.zoneId] = defaultStaff; });
      return next;
    });
    setRouteZoneFlyer((prev) => {
      const next = { ...prev };
      routeZones.forEach((z) => { if (next[z.zoneId] === undefined) next[z.zoneId] = defaultFlyer; });
      return next;
    });
    if (!selectedRouteZoneId || !routeZones.some((z) => z.zoneId === selectedRouteZoneId)) {
      setSelectedRouteZoneId(routeZones[0].zoneId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeZones, staff, campaigns]);

  // Resolve the effective flyer for a stop: per-location override -> zone flyer.
  function flyerForStop(zone: RouteZone, stopOrder: number): string {
    return routeStopFlyer[stopOrder] || routeZoneFlyer[zone.zoneId] || '';
  }

  function flash(msg: string) {
    setMessage(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setMessage(''), 6000);
  }

  async function loadInitialData() {
    setLoading(true);
    try {
      const [campRes, staffRes, specRes] = await Promise.all([
        api.get('/campaigns/active'),
        api.get('/client-workflow/staff'),
        api.get('/client-workflow/doctor-specialties')
      ]);
      setCampaigns(campRes.data || []);
      setStaff(staffRes.data || []);

      const rawTypes = Array.isArray(specRes.data?.doctorTypes) ? specRes.data.doctorTypes : [];
      const opts: DoctorTypeOption[] = rawTypes
        .map((item: any) => ({
          value: str(item.value || item.code),
          label: str(item.label) || `${str(item.code)} – ${str(item.displayName)}`,
          count: Number(item.count || 0)
        }))
        .filter((o: DoctorTypeOption) => o.value && o.label);
      setSpecialtyOpts([...BASE_OPTIONS, ...opts]);

      if (campRes.data?.[0]?.CampaignId) {
        const firstCampaign = String(campRes.data[0].CampaignId);
        setForm((p) => ({ ...p, campaignId: p.campaignId || firstCampaign }));
        setBulkAssign((p) => ({ ...p, campaignId: p.campaignId || firstCampaign }));
        setCampaignEntries((prev) =>
          prev.length === 1 && !prev[0].campaignId
            ? [{ ...prev[0], campaignId: firstCampaign }]
            : prev
        );
      }
      if (staffRes.data?.[0]?.ID) {
        setStaffByZone((p) => ({ ...p, default: String(staffRes.data[0].ID) }));
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Failed to load initial data.';
      setError(msg);
      if (String(msg).includes('401')) router.push('/');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) { router.push('/'); return; }
    loadInitialData();
    return () => { if (successTimer.current) clearTimeout(successTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setPreviewPage(1); }, [previewSearch, preview]);

  // ── Multi-campaign entry handlers ───────────────────────────────────────────
  function addCampaignEntry() {
    setCampaignEntries((prev) => [...prev, newCampaignEntry('')]);
  }
  function removeCampaignEntry(id: string) {
    setCampaignEntries((prev) => (prev.length <= 1 ? prev : prev.filter((e) => e.id !== id)));
  }
  function updateCampaignEntry(id: string, patch: Partial<CampaignEntry>) {
    setCampaignEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  const activeCampaignEntries = useMemo(
    () => campaignEntries.filter((e) => e.campaignId),
    [campaignEntries]
  );
  const canBuild = activeCampaignEntries.length > 0;

  // Match doctors for every campaign entry and merge them by physical doctor, where each
  // doctor carries the union of flyers it must receive (overlapping locations collapse).
  async function previewAll(): Promise<{ doctors: MergedDoctor[]; hours: number; center: { latitude: number; longitude: number } | null } | null> {
    if (!activeCampaignEntries.length) { setError('Add at least one flyer campaign.'); return null; }
    setError('');
    setMessage('');

    const merged = new Map<string, MergedDoctor>();
    let hours = Number(form.customHours || 8);
    let center: { latitude: number; longitude: number } | null = null;

    try {
      for (const entry of activeCampaignEntries) {
        const cid = Number(entry.campaignId);
        const camp = campaigns.find((c) => c.CampaignId === cid);
        const flyer: Flyer = { campaignId: cid, campaignName: campaignName(camp) || `Campaign ${cid}` };
        const doctorTypes = entry.doctorTypes.length ? entry.doctorTypes : ['Any'];

        const res = await api.post('/client-workflow/doctor-preview-zones', {
          campaignId:   cid,
          city:         form.city,
          state:        'FL',
          doctorTypes,
          capacityType: form.capacityType,
          customHours:  Number(form.customHours || 8),
          limit:        5000
        });
        const data = res.data as PreviewResponse;
        if (!center) center = data.cityCenter;
        hours = data.filters.capacityHours;

        for (const d of [...(data.doctors || []), ...(data.needsCoordinates || [])]) {
          const key = doctorKey(d);
          let m = merged.get(key);
          if (!m) { m = { ...d, flyers: [] }; merged.set(key, m); }
          if (!m.flyers.some((f) => f.campaignId === cid)) m.flyers.push(flyer);
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Preview failed.');
      return null;
    }

    const doctors = Array.from(merged.values());
    setPreview(null);
    setZones([]);
    setNeedsCoords([]);
    setMatchedCount(doctors.length);
    setRoutePlan(null);
    return { doctors, hours, center };
  }

  // One-click: match doctors across all campaigns then build the optimized route.
  // Records a streamed progress event and derives a per-phase ETA from the
  // observed rate (each geocode/OSRM unit is ~1s, so this converges quickly).
  function handleProgress(ev: { phase: RoutePhase; done?: number; total?: number }) {
    const now = Date.now();
    const done = ev.done ?? 0;
    const total = ev.total ?? 0;
    if (!phaseTimingRef.current || phaseTimingRef.current.phase !== ev.phase) {
      phaseTimingRef.current = { phase: ev.phase, at: now };
    }
    let etaSec: number | null = null;
    if (total > 0 && done > 0) {
      const perUnitSec = (now - phaseTimingRef.current.at) / done / 1000;
      etaSec = Math.max(0, Math.round((total - done) * perUnitSec));
    }
    setRouteProgress({ phase: ev.phase, done, total, etaSec, etaAt: now });
  }

  // POST to the streaming endpoint and resolve with the final plan, forwarding
  // each progress line to `onEvent` as it arrives.
  async function streamOptimize(body: any, onEvent: (ev: any) => void): Promise<RoutePlan> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const resp = await fetch(`${API_BASE_URL}/client-workflow/optimize-route/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok || !resp.body) {
      let msg = `Route optimization failed (HTTP ${resp.status}).`;
      try { const j = await resp.json(); if (j?.message) msg = j.message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let plan: RoutePlan | null = null;
    let errMsg: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'done') plan = ev.plan as RoutePlan;
        else if (ev.type === 'error') errMsg = ev.message || 'Route optimization failed.';
        else if (ev.type === 'progress') onEvent(ev);
        // 'ping' heartbeats are ignored
      }
    }
    if (errMsg) throw new Error(errMsg);
    if (!plan) throw new Error('Route optimization ended without a result.');
    return plan;
  }

  async function buildRoute() {
    if (!canBuild) { setError('Add at least one flyer campaign.'); return; }
    setBusy('route');
    setError('');
    setMessage('');
    routeStartRef.current = Date.now();
    phaseTimingRef.current = { phase: 'matching', at: Date.now() };
    setRouteProgress({ phase: 'matching', done: 0, total: 0, etaSec: null, etaAt: Date.now() });
    const result = await previewAll();
    if (!result) { setBusy(''); setRouteProgress(null); return; }
    await optimizeRoute(result.doctors, result.hours);
  }

  async function optimizeRoute(mergedDoctors: MergedDoctor[], hours: number) {
    if (!mergedDoctors.length) { setError('No doctors matched.'); setBusy(''); return; }

    setBusy('route');
    setError('');
    try {
      // No-overlap rule: drop any doctor that already belongs to a saved route so the
      // new route never reuses a location that is already on another route.
      let takenIds = new Set<number>();
      let takenNames = new Set<string>();
      try {
        const taken = await api.get('/client-workflow/routes/routed-locations');
        takenIds = new Set<number>((taken.data?.doctorIds || []).map((n: any) => Number(n)));
        takenNames = new Set<string>(taken.data?.nameKeys || []);
      } catch { /* if it fails, fall back to routing everything */ }

      const isTaken = (d: PreviewDoctor) => {
        if (d.doctorId != null) return takenIds.has(Number(d.doctorId));
        const key = `${str(d.targetName).toLowerCase()}|${str(d.addressZip)}`;
        return takenNames.has(key);
      };

      const available = mergedDoctors.filter((d) => !isTaken(d));
      const excluded = mergedDoctors.length - available.length;

      // Remember each doctor's flyers so save can fan one stop into N flyer drops.
      const flyerMap = new Map<string, Flyer[]>();
      for (const d of available) flyerMap.set(keyOf(d.doctorId, d.targetName, d.addressZip), d.flyers);
      doctorFlyersRef.current = flyerMap;

      const doctors = available.map((d) => ({
        doctorId: d.doctorId ?? null,
        targetName: d.targetName,
        npiNumber: d.npiNumber ?? null,
        specialty: d.specialty ?? null,
        addressStreet: d.addressStreet ?? null,
        addressCity: d.addressCity ?? null,
        addressState: d.addressState ?? 'FL',
        addressZip: d.addressZip ?? null,
        phone: d.phone ?? null,
        latitude: d.latitude ?? null,
        longitude: d.longitude ?? null
      }));
      if (!doctors.length) {
        setError(excluded > 0
          ? 'All matched doctors are already on existing routes. Delete a route to free them.'
          : 'No doctors to route.');
        setBusy('');
        return;
      }

      const plan = await streamOptimize({
        doctors,
        hours,
        pitStopMinutes: Number(routeOpts.pitStopMinutes || 10),
        travel: routeOpts.travel,
        startTime: '09:00'
      }, handleProgress);

      // Count total flyer drops (a doctor with 2 flyers = 2 drops at one location).
      let drops = 0;
      for (const s of plan.stops) {
        for (const d of s.doctors) {
          drops += (flyerMap.get(keyOf(d.doctorId, d.targetName, d.addressZip))?.length || 1);
        }
      }
      setRouteFlyerCount(drops);

      setRoutePlan(plan);
      setRouteName(generateRouteName(form.city));
      setRouteZonePerson({});
      setRouteZoneFlyer({});
      setRouteStopFlyer({});
      setSelectedRouteZoneId('');
      flash(
        `Optimized route: ${plan.summary.locations} stops · ${plan.summary.doctors} doctors · ${drops} flyer drop(s) · ` +
        `${plan.summary.driveMin} min drive · ${plan.summary.utilizationPct}% of ${plan.summary.shiftHours}h (via ${plan.engine})` +
        (excluded > 0 ? ` · ${excluded} already on other routes excluded.` : '.')
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Route optimization failed.');
    } finally {
      setBusy('');
      setRouteProgress(null);
      phaseTimingRef.current = null;
    }
  }

  async function saveRoute() {
    if (!routePlan) { setError('Build the optimized route first.'); return; }
    const name = routeName.trim() || generateRouteName(form.city);

    const flyerMap = doctorFlyersRef.current;
    // Fan each routed doctor out into one assignment per flyer it must receive.
    const doctorAssignments = routePlan.stops.flatMap((s) =>
      s.doctors.flatMap((d) => {
        const flyers = flyerMap.get(keyOf(d.doctorId, d.targetName, d.addressZip)) || [];
        if (!flyers.length) return [];
        return flyers.map((f) => ({
          campaignId:    f.campaignId,
          doctorId:      d.doctorId ?? null,
          targetType:    'Doctor',
          targetName:    d.targetName,
          npiNumber:     d.npiNumber ?? null,
          specialty:     d.specialty ?? null,
          addressStreet: d.addressStreet ?? null,
          addressCity:   d.addressCity ?? null,
          addressState:  d.addressState ?? 'FL',
          addressZip:    d.addressZip ?? null,
          phone:         d.phone ?? null,
          latitude:      d.latitude ?? null,
          longitude:     d.longitude ?? null,
          routeStopOrder: s.stopOrder
        }));
      })
    );

    if (!doctorAssignments.length) { setError('No flyers to save on this route.'); return; }

    setBusy('save-route');
    setError('');
    try {
      const firstStop = routePlan.stops[0];
      const res = await api.post('/client-workflow/routes/save', {
        routeName:      name,
        scheduledDate:  form.scheduledDate,
        startLatitude:  firstStop?.latitude ?? null,
        startLongitude: firstStop?.longitude ?? null,
        doctorAssignments
      });
      const saved = Number(res.data?.savedCount || 0);
      const drops = Number(res.data?.assignmentCount || doctorAssignments.length);
      const skipped = Number(res.data?.skippedOverlap || 0);
      flash(
        `Saved "${name}" with ${saved} location(s) · ${drops} flyer drop(s)` +
        (skipped > 0 ? ` (${skipped} skipped — already on other routes)` : '') +
        `. Open Available Routes to assign it to a person.`
      );
      setRoutePlan(null);
      setRouteName('');
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not save route.');
    } finally {
      setBusy('');
    }
  }

  async function createRouteZoneAssignments(zone: RouteZone) {
    const userId = Number(routeZonePerson[zone.zoneId]);
    if (!userId) { setError(`Assign a person to ${zone.name} first.`); return; }

    const assignments = zone.stops.flatMap((s) => {
      const cid = Number(flyerForStop(zone, s.stopOrder));
      if (!cid) return [];
      return s.doctors.map((d) => ({
        campaignId:    cid,
        doctorId:      d.doctorId ?? null,
        targetType:    'Doctor',
        targetName:    d.targetName,
        npiNumber:     d.npiNumber ?? null,
        specialty:     d.specialty ?? null,
        addressStreet: d.addressStreet ?? null,
        addressCity:   d.addressCity ?? null,
        addressState:  d.addressState ?? 'FL',
        addressZip:    d.addressZip ?? null,
        phone:         d.phone ?? null,
        latitude:      d.latitude ?? null,
        longitude:     d.longitude ?? null,
        routeStopOrder: s.stopOrder
      }));
    });

    if (!assignments.length) { setError(`No flyers assigned in ${zone.name}. Pick a flyer first.`); return; }

    setBusy(`rzone-${zone.zoneId}`);
    setError('');
    try {
      const firstStop = zone.stops[0];
      // Build the route directly in the exact optimized order (no nearest-neighbour
      // re-sort, no stop cap), replacing any stale route for this person + date so
      // the mobile "Today Route" shows only this plan.
      const res = await api.post('/client-workflow/zones/create-route', {
        staffUserId:    userId,
        scheduledDate:  form.scheduledDate,
        replaceExisting: true,
        startLatitude:  firstStop?.latitude ?? null,
        startLongitude: firstStop?.longitude ?? null,
        routeName:      `${zone.name} · ${form.scheduledDate}`,
        doctorAssignments: assignments
      });
      const routed = Number(res.data?.stopCount || 0);
      const c = Number(res.data?.createdCount || 0);
      const u = Number(res.data?.updatedCount || 0);

      const person = staff.find((s) => String(s.ID) === String(userId));
      const isToday = form.scheduledDate === today;
      flash(
        `${zone.name} → ${person ? staffName(person) : 'staff'}: ${routed} stop(s) routed ` +
        `(${c} new, ${u} updated) for ${form.scheduledDate}. ` +
        (isToday
          ? `Open the mobile app's Today Route to see them.`
          : `⚠ This date is not today — the mobile Today Route only shows ${today}.`)
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || `Assignment failed for ${zone.name}.`);
    } finally {
      setBusy('');
    }
  }

  // Clears every planning field and result on this page (local only — no saved
  // routes/assignments are touched) so you can start a brand-new route plan.
  function clearPlan() {
    setForm({
      campaignId:   '',
      doctorType:   'Any',
      city:         'St. Petersburg',
      capacityType: 'full_time',
      customHours:  '8',
      scheduledDate: today
    });
    setCampaignEntries([newCampaignEntry()]);
    setPreview(null);
    setZones([]);
    setNeedsCoords([]);
    setSelectedZoneId('');
    setStaffByZone({});
    setDoctorFlyers({});
    setPopupDoctor(null);
    setPreviewSearch('');
    setPreviewPage(1);
    setZoneSearch('');
    setBulkAssign({ specialty: 'All', campaignId: '' });
    setRoutePlan(null);
    setRouteOpts({ pitStopMinutes: '10', travel: 'osrm' });
    setRouteZoneCount(3);
    setSelectedRouteZoneId('');
    setRouteZonePerson({});
    setRouteZoneFlyer({});
    setRouteStopFlyer({});
    setRouteName('');
    setMatchedCount(0);
    setRouteFlyerCount(0);
    doctorFlyersRef.current = new Map();
    setRouteProgress(null);
    phaseTimingRef.current = null;
    setError('');
    setMessage('');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function resetWorkflowData() {
    if (typeof window !== 'undefined' &&
        !window.confirm('Delete ALL generated assignments, routes and stops so the mobile app starts fresh? This cannot be undone. Campaigns, doctors and users are kept.')) {
      return;
    }
    setBusy('reset');
    setError('');
    try {
      const res = await api.post('/client-workflow/admin/reset-workflow-data', {});
      const d = res.data?.deleted || {};
      flash(`Started fresh — deleted ${d.assignments ?? 0} assignments, ${d.routes ?? 0} routes, ${d.routeStops ?? 0} stops. The mobile app is now empty.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Reset failed.');
    } finally {
      setBusy('');
    }
  }

  function applyBulkFlyer() {
    if (!selectedZone) return;
    const cid = Number(bulkAssign.campaignId);
    if (!cid) { setError('Select a flyer for bulk assignment.'); return; }
    setDoctorFlyers((prev) => {
      const next = { ...prev };
      selectedZone.doctors.forEach((d) => {
        if (bulkAssign.specialty === 'All' || specialty(d) === bulkAssign.specialty) {
          next[doctorKey(d)] = cid;
        }
      });
      return next;
    });
    flash(`Applied "${campaignName(campaigns.find((c) => c.CampaignId === cid))}" to ${bulkAssign.specialty === 'All' ? 'all' : bulkAssign.specialty} doctors in ${selectedZone.zoneName}.`);
  }

  function splitZone(zoneId: string) {
    if (!preview) return;
    setZones((current) => {
      const target = current.find((z) => z.zoneId === zoneId);
      if (!target || target.doctors.length < 4) return current;
      const sorted = [...target.doctors].sort((a, b) => (a.distanceMiles || 0) - (b.distanceMiles || 0));
      const mid = Math.ceil(sorted.length / 2);

      const makeHalf = (suffix: string, docs: PreviewDoctor[]): Zone => {
        const bd: Record<string, number> = {};
        docs.forEach((d) => { const s = specialty(d); bd[s] = (bd[s] || 0) + 1; });
        const mins = estimateMinutes(docs.length, target.endMiles, preview.constants);
        const hrs  = Number((mins / 60).toFixed(1));
        const gap  = hrs - preview.filters.capacityHours;
        const cs: Zone['capacityStatus'] = gap > 0.5 ? 'over' : gap < -0.5 ? 'under' : 'fits';
        return {
          ...target,
          zoneId: `${target.zoneId}_${suffix.toLowerCase()}`,
          zoneName: `${target.zoneName}${suffix}`,
          doctorsCount: docs.length,
          specialtyBreakdown: bd,
          estimatedMinutes: mins,
          estimatedHours: hrs,
          capacityStatus: cs,
          suggestedPeopleOrDays: cs === 'over' ? Math.max(2, Math.ceil(hrs / preview.filters.capacityHours)) : 1,
          doctors: docs
        };
      };

      const next = current.flatMap((z) =>
        z.zoneId !== zoneId ? [z] : [makeHalf('A', sorted.slice(0, mid)), makeHalf('B', sorted.slice(mid))]
      );
      setSelectedZoneId(`${zoneId}_a`);
      return next;
    });
  }

  async function createAssignments(zone: Zone) {
    if (zone.capacityStatus === 'over') {
      setError(`${zone.zoneName} is over capacity (${zone.suggestedPeopleOrDays} people/days needed). Split it first.`);
      return;
    }
    const userId = Number(staffByZone[zone.zoneId] || staffByZone.default);
    if (!userId) { setError(`Assign a staff member to ${zone.zoneName} first.`); return; }

    const assignments = zone.doctors
      .map((d) => {
        const cid = doctorFlyers[doctorKey(d)];
        if (!cid) return null;
        return {
          campaignId:   cid,
          doctorId:     d.doctorId ?? null,
          targetType:   'Doctor',
          targetName:   d.targetName,
          npiNumber:    d.npiNumber ?? null,
          specialty:    specialty(d),
          addressStreet: d.addressStreet ?? null,
          addressCity:  d.addressCity ?? null,
          addressState: d.addressState ?? 'FL',
          addressZip:   d.addressZip ?? null,
          phone:        d.phone ?? null,
          latitude:     d.latitude ?? null,
          longitude:    d.longitude ?? null
        };
      })
      .filter(Boolean);

    if (!assignments.length) { setError(`No flyers assigned in ${zone.zoneName}. Assign flyers first.`); return; }

    setBusy(`assign-${zone.zoneId}`);
    setError('');
    try {
      const res = await api.post('/client-workflow/zones/create-assignments', {
        staffUserId:   userId,
        scheduledDate: form.scheduledDate,
        autoApprove:   true,
        doctorAssignments: assignments
      });
      const c = Number(res.data?.createdCount || 0);
      const u = Number(res.data?.updatedCount || 0);
      flash(`${zone.zoneName}: ${c} created + ${u} updated. Mobile flow ready.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || `Assignment failed for ${zone.zoneName}.`);
    } finally {
      setBusy('');
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="wf-root">
      {/* ── Header ── */}
      <header className="wf-hero">
        <div>
          <span className="wf-hero-badge">Distribution planner</span>
          <h1>Flyer Distribution Workflow</h1>
          <p>Match doctors, build one route, save it, then assign from Available Routes.</p>
        </div>
        <div className="wf-hero-right">
          {matchedCount > 0 && (
            <div className="wf-hero-stats">
              <Stat label="Doctors matched" value={matchedCount} />
              {routePlan && <Stat label="Stops" value={routePlan.summary.locations} />}
              {routePlan && <Stat label="Doctors routed" value={routePlan.summary.doctors} />}
              {routePlan && <Stat label="Flyer drops" value={routeFlyerCount} />}
            </div>
          )}
          <div className="wf-hero-actions">
            <button className="btn-ghost-light" onClick={clearPlan} disabled={busy === 'route' || busy === 'save-route'}>
              ✕ New plan
            </button>
            <button className="btn-ghost-light" onClick={resetWorkflowData} disabled={busy === 'reset'}>
              {busy === 'reset' ? '⟳ Resetting…' : '⟲ Start fresh'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Alerts ── */}
      {error   && <div className="wf-alert error"   onClick={() => setError('')}>{error}</div>}
      {message && <div className="wf-alert success">{message}</div>}

      {/* ── Plan a distribution route (search + optimize in one) ── */}
      <div className="wf-card wf-plan-card">
          <div className="wf-plan-header">
            <span className="wf-plan-step">1</span>
            <div className="wf-plan-intro">
              <h2 className="wf-card-title">Plan a distribution route</h2>
              <p className="wf-card-sub">Add campaigns with doctor types, set shared city/date/capacity, then build the route.</p>
            </div>
          </div>

          <section className="wf-section">
            <h3 className="wf-section-label">Flyer campaigns</h3>
            <div className="wf-campaigns">
              {campaignEntries.map((entry, idx) => (
                <div className="wf-campaign-row" key={entry.id}>
                  <span className="wf-campaign-index">{idx + 1}</span>
                  <div className="wf-campaign-fields">
                    <Field label={idx === 0 ? 'Flyer campaign' : `Flyer campaign #${idx + 1}`}>
                      <select
                        value={entry.campaignId}
                        onChange={(e) => updateCampaignEntry(entry.id, { campaignId: e.target.value })}
                      >
                        <option value="">Select campaign</option>
                        {campaigns.map((c) => <option key={c.CampaignId} value={c.CampaignId}>{campaignName(c)}</option>)}
                      </select>
                    </Field>
                    <Field label="Doctor types">
                      <DoctorTypeMultiSelect
                        options={specialtyOpts}
                        selected={entry.doctorTypes}
                        onChange={(doctorTypes) => updateCampaignEntry(entry.id, { doctorTypes })}
                      />
                    </Field>
                  </div>
                  {campaignEntries.length > 1 && (
                    <button
                      type="button"
                      className="wf-campaign-remove"
                      title="Remove this campaign"
                      onClick={() => removeCampaignEntry(entry.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="wf-add-campaign" onClick={addCampaignEntry}>
                + Add another flyer campaign
              </button>
            </div>
          </section>

          <section className="wf-section">
            <h3 className="wf-section-label">Shared settings</h3>
            <div className="wf-grid wf-grid-shared">
              <Field label="City">
                <select value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}>
                  <option value="St. Petersburg">St. Petersburg</option>
                  <option value="Pinellas Park">Pinellas Park</option>
                </select>
              </Field>

              <Field label="Work capacity">
                <select value={form.capacityType} onChange={(e) => setForm((p) => ({ ...p, capacityType: e.target.value as CapacityType }))}>
                  <option value="full_time">Full time (8h)</option>
                  <option value="part_time">Part time (5h)</option>
                  <option value="custom">Custom hours</option>
                </select>
              </Field>

              <Field label="Scheduled date">
                <input className="wf-input-date" type="date" value={form.scheduledDate} onChange={(e) => setForm((p) => ({ ...p, scheduledDate: e.target.value }))} />
              </Field>
            </div>

            {form.capacityType === 'custom' && (
              <div className="wf-custom-hours">
                <Field label="Custom hours">
                  <input className="wf-input-number" type="number" min={0.1} max={16} step={0.1} value={form.customHours}
                    onChange={(e) => setForm((p) => ({ ...p, customHours: e.target.value }))} />
                </Field>
              </div>
            )}
          </section>

          <section className="wf-section wf-route-panel">
            <h3 className="wf-section-label">Route optimization</h3>
            <div className="wf-route-controls">
              <Field label="Minutes per stop">
                <input
                  className="wf-input-number"
                  type="number"
                  min={1}
                  max={60}
                  value={routeOpts.pitStopMinutes}
                  onChange={(e) => setRouteOpts((p) => ({ ...p, pitStopMinutes: e.target.value }))}
                />
              </Field>
              <Field label="Travel engine">
                <select
                  value={routeOpts.travel}
                  onChange={(e) => setRouteOpts((p) => ({ ...p, travel: e.target.value as 'osrm' | 'offline' }))}
                >
                  <option value="osrm">OSRM (real road times)</option>
                  <option value="offline">Offline estimate</option>
                </select>
              </Field>
              <div className="wf-build-wrap">
                <button
                  type="button"
                  className="btn-primary btn-lg wf-build-btn"
                  onClick={buildRoute}
                  disabled={busy === 'route' || loading || !canBuild}
                >
                  {busy === 'route' ? 'Building route…' : 'Build optimized route'}
                </button>
              </div>
            </div>
            {busy === 'route' && (
              <RouteProgressBar progress={routeProgress} startMs={routeStartRef.current} now={nowTick} />
            )}

            {routePlan && (
              <>
                <div className="wf-summary-row" style={{ flexWrap: 'wrap' }}>
                  <Chip label="Stops" value={routePlan.summary.locations} color="#2563eb" />
                  <Chip label="Doctors routed" value={routePlan.summary.doctors} color="#16a34a" />
                  <Chip label="Drive" value={`${routePlan.summary.driveMin} min`} />
                  <Chip label="At stops" value={`${routePlan.summary.serviceMin} min`} />
                  <Chip label="Total" value={`${routePlan.summary.totalMin} min`} />
                  <Chip
                    label="Shift used"
                    value={`${routePlan.summary.utilizationPct}%`}
                    color={routePlan.summary.utilizationPct > 100 ? '#dc2626' : '#16a34a'}
                  />
                  <Chip label="Engine" value={routePlan.engine} />
                </div>

                {/* Built-in interactive map (OpenStreetMap / Leaflet) */}
                <RouteZoneMap zones={routeMapZones} selectedZoneId="route" />

                {/* Save the route (no assignment yet) */}
                <div className="wf-save-route">
                  <Field label="Route name">
                    <input
                      value={routeName}
                      onChange={(e) => setRouteName(e.target.value)}
                      placeholder="Route name"
                    />
                  </Field>
                  <button
                    className="btn-primary btn-lg"
                    onClick={saveRoute}
                    disabled={busy === 'save-route'}
                  >
                    {busy === 'save-route' ? '⟳ Saving…' : '💾 Save route'}
                  </button>
                  <p className="wf-save-hint">
                    Saves without assigning. Assign later from <strong>Available Routes</strong>.
                  </p>
                </div>

                {routePlan.uncovered.length > 0 && (
                  <div className="wf-needs-coords">
                    <strong>{routePlan.uncovered.length} doctors not in this route</strong>{' '}
                    ({routePlan.uncovered.filter((u) => u.reason === 'not_enough_capacity').length} didn&rsquo;t fit the {routePlan.summary.shiftHours}h shift,{' '}
                    {routePlan.uncovered.filter((u) => u.reason === 'could_not_geocode').length} could not be geocoded). Run again with more hours or a follow-up campaign to cover them.
                  </div>
                )}
              </>
            )}
          </section>
      </div>

    </div>
  );
}

// ─── Small presentational components ─────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="wf-field">{label}{children}</label>;
}

// Tag-style multi-select dropdown for doctor types. The trigger shows the chosen
// types as removable chips; the panel has a search box and a styled checklist.
// Selecting "Any" clears specific types; picking a specific type clears "Any".
function DoctorTypeMultiSelect({
  options,
  selected,
  onChange
}: {
  options: DoctorTypeOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isAny = selected.length === 0 || selected.includes('Any');

  const specific = options.filter((o) => o.value !== 'Any');
  const selectedOpts = specific.filter((o) => selected.includes(o.value));

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return specific;
    return specific.filter((o) => o.label.toUpperCase().includes(q) || o.value.toUpperCase().includes(q));
  }, [specific, query]);

  function toggle(value: string) {
    if (value === 'Any') { onChange(['Any']); setQuery(''); return; }
    const next = new Set(selected.filter((v) => v !== 'Any'));
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(next.size ? Array.from(next) : ['Any']);
  }

  return (
    <div className={open ? 'wf-ms is-open' : 'wf-ms'}>
      <button
        type="button"
        className={`wf-ms-control${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="wf-ms-tags">
          {isAny ? (
            <span className="wf-ms-placeholder">Any doctor type</span>
          ) : (
            selectedOpts.map((o) => (
              <span key={o.value} className="wf-ms-tag" onClick={(e) => { e.stopPropagation(); toggle(o.value); }}>
                {o.label}
                <span className="wf-ms-tag-x">✕</span>
              </span>
            ))
          )}
        </span>
        <span className="wf-ms-caret">▾</span>
      </button>

      {open && (
        <>
          <div className="wf-ms-backdrop" onClick={() => { setOpen(false); setQuery(''); }} />
          <div className="wf-ms-panel">
            <div className="wf-ms-search">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search doctor types…"
              />
            </div>
            <div className="wf-ms-list">
              <button type="button" className={`wf-ms-opt${isAny ? ' on' : ''}`} onClick={() => toggle('Any')}>
                <span className="wf-ms-check">{isAny ? '✓' : ''}</span>
                <span className="wf-ms-opt-label">Any doctor type</span>
              </button>
              <div className="wf-ms-divider" />
              {filtered.length ? filtered.map((o) => {
                const on = !isAny && selected.includes(o.value);
                return (
                  <button type="button" key={o.value} className={`wf-ms-opt${on ? ' on' : ''}`} onClick={() => toggle(o.value)}>
                    <span className="wf-ms-check">{on ? '✓' : ''}</span>
                    <span className="wf-ms-opt-label">{o.label}</span>
                    {o.count ? <span className="wf-ms-opt-count">{o.count}</span> : null}
                  </button>
                );
              }) : <div className="wf-ms-empty">No matches</div>}
            </div>
            <div className="wf-ms-footer">
              <span className="wf-ms-footer-count">{isAny ? 'Any doctor type' : `${selectedOpts.length} selected`}</span>
              <div className="wf-ms-footer-actions">
                {!isAny && (
                  <button type="button" className="wf-ms-clear" onClick={() => { onChange(['Any']); setQuery(''); }}>
                    Clear
                  </button>
                )}
                <button type="button" className="wf-ms-done" onClick={() => { setOpen(false); setQuery(''); }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Live progress UI shown beside the Build button. Renders a labelled bar per
// phase (determinate when counts are known, animated otherwise), a live ETA for
// the current phase, and an overall elapsed clock so the user knows work is
// happening and roughly how long is left.
function RouteProgressBar({
  progress,
  startMs,
  now
}: {
  progress: RouteProgress | null;
  startMs: number;
  now: number;
}) {
  const nowMs = now || Date.now();
  const elapsed = startMs ? Math.max(0, (nowMs - startMs) / 1000) : 0;

  const LABELS: Record<RoutePhase, string> = {
    matching: 'Matching doctors across campaigns',
    geocode:  'Geocoding addresses (OpenStreetMap)',
    matrix:   'Building driving-time matrix (OSRM)',
    solve:    'Optimizing route order'
  };
  const ORDER: RoutePhase[] = ['matching', 'geocode', 'matrix', 'solve'];

  const phase = progress?.phase ?? 'matching';
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const determinate = total > 0 && done > 0;
  const pct = determinate ? Math.min(100, Math.round((done / total) * 100)) : 0;

  // Count the ETA down smoothly between events.
  let etaSec: number | null = null;
  if (progress?.etaSec != null) {
    etaSec = Math.max(0, progress.etaSec - (nowMs - progress.etaAt) / 1000);
  }

  const phaseIdx = ORDER.indexOf(phase);

  return (
    <div className="wf-progress">
      <div className="wf-progress-top">
        <span className="wf-progress-spin">⟳</span>
        <span className="wf-progress-label">{LABELS[phase]}</span>
        {determinate && <span className="wf-progress-count">{done}/{total}</span>}
        <span className="wf-progress-spacer" />
        {etaSec != null
          ? <span className="wf-progress-eta">~{fmtClock(etaSec)} left</span>
          : <span className="wf-progress-eta wf-progress-eta-muted">estimating…</span>}
        <span className="wf-progress-elapsed">{fmtClock(elapsed)} elapsed</span>
      </div>

      <div className={`wf-progress-track${determinate ? '' : ' indeterminate'}`}>
        <div className="wf-progress-fill" style={determinate ? { width: `${pct}%` } : undefined} />
      </div>

      <div className="wf-progress-steps">
        {ORDER.map((p, i) => (
          <span
            key={p}
            className={`wf-progress-step${i < phaseIdx ? ' done' : ''}${i === phaseIdx ? ' active' : ''}`}
          >
            {i < phaseIdx ? '✓' : i + 1} {LABELS[p].split(' ')[0]}
          </span>
        ))}
      </div>

      <p className="wf-progress-note">
        Keeping this page open — geocoding new addresses (~1/sec, cached for next time) and
        OSRM road-time tiles are the slow parts. The estimate sharpens as it runs.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="wf-stat">
      <span>{typeof value === 'number' ? value.toLocaleString() : value}</span>
      <small>{label}</small>
    </div>
  );
}

function Chip({ label, value, color = '#2563eb' }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 10px' }}>
      <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
      <strong style={{ fontSize: 14, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
    </div>
  );
}
