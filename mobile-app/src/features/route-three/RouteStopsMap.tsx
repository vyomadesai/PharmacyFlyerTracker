import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polygon, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { formatDistance, locationTitle, milesBetween, numberValue } from './routeHelpers';
import type { V2Location } from './types';

const DEFAULT_RADIUS_MILES = 5;
const MILES_TO_METERS = 1609.344;

/** Dev-only transparent washes. Each band is one ring, so the fills do not stack. */
const DEV_RINGS = [
  { miles: 0.1, fill: 'rgba(251, 113, 133, 0.22)', stroke: 'rgba(251, 113, 133, 0.35)' },
  { miles: 1, fill: 'rgba(251, 146, 60, 0.16)', stroke: 'rgba(251, 146, 60, 0.28)' },
  { miles: 2, fill: 'rgba(250, 204, 21, 0.18)', stroke: 'rgba(202, 138, 4, 0.28)' },
  { miles: 3, fill: 'rgba(45, 212, 191, 0.16)', stroke: 'rgba(13, 148, 136, 0.28)' },
  { miles: 4, fill: 'rgba(167, 139, 250, 0.16)', stroke: 'rgba(124, 58, 237, 0.25)' },
  { miles: 5, fill: 'rgba(96, 165, 250, 0.16)', stroke: 'rgba(37, 99, 235, 0.28)' },
] as const;
const DEV_BANDS = [
  { max: 0.1, label: '≤0.1' },
  { max: 1, label: '0.1–1' },
  { max: 2, label: '1–2' },
  { max: 3, label: '2–3' },
  { max: 4, label: '3–4' },
  { max: 5, label: '4–5' },
] as const;

type Props = {
  stops: V2Location[];
  activeLocationKey: string | null;
  userLatitude?: number | null;
  userLongitude?: number | null;
  radiusMiles?: number | null;
  radiusLatitude?: number | null;
  radiusLongitude?: number | null;
  isStopDone: (loc: V2Location) => boolean;
  onSelectStop: (loc: V2Location) => void;
  onOpenStop: (loc: V2Location) => void;
  onNavigate: () => void;
};

type MapPoint = {
  loc: V2Location;
  index: number;
  latitude: number;
  longitude: number;
};

function stopPoint(loc: V2Location, index: number): MapPoint | null {
  const latitude = numberValue(loc.latitude);
  const longitude = numberValue(loc.longitude);
  if (latitude == null || longitude == null) return null;
  return { loc, index, latitude, longitude };
}

function ringPoints(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  steps = 72,
) {
  const earth = 6378137;
  const lat1 = (latitude * Math.PI) / 180;
  const lng1 = (longitude * Math.PI) / 180;
  const ang = radiusMeters / earth;
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(bearing),
    );
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
    points.push({ latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI });
  }
  return points;
}

function regionForRadius(latitude: number, longitude: number, miles: number): Region {
  const latitudeDelta = (miles * 2 * 1.2) / 69;
  const longitudeDelta = latitudeDelta / Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

function regionForPoints(
  points: Array<{ latitude: number; longitude: number }>,
): Region {
  if (!points.length) {
    return {
      latitude: 27.7712,
      longitude: -82.6586,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }
  if (points.length === 1) {
    return {
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
  }
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.03),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.03),
  };
}

export default function RouteStopsMap({
  stops,
  activeLocationKey,
  userLatitude,
  userLongitude,
  radiusMiles,
  radiusLatitude,
  radiusLongitude,
  isStopDone,
  onOpenStop,
  onNavigate,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const points = useMemo(
    () => stops.map((loc, index) => stopPoint(loc, index)).filter((row): row is MapPoint => row != null),
    [stops],
  );
  const missingCount = stops.length - points.length;
  const active = stops.find((loc) => loc.locationKey === activeLocationKey) || stops[0] || null;
  const fitKey = points.map((p) => p.loc.locationKey).join('|');
  const userPoint =
    userLatitude != null && userLongitude != null
      ? { latitude: userLatitude, longitude: userLongitude }
      : null;

  function milesToStop(loc: V2Location) {
    const latitude = numberValue(loc.latitude);
    const longitude = numberValue(loc.longitude);
    if (!userPoint || latitude == null || longitude == null) return null;
    return milesBetween(userPoint, { latitude, longitude });
  }

  const workRadiusMiles = radiusMiles != null && radiusMiles > 0 ? radiusMiles : DEFAULT_RADIUS_MILES;
  const radiusCenter = useMemo(() => {
    const latitude = numberValue(radiusLatitude) ?? (userLatitude != null ? userLatitude : null);
    const longitude = numberValue(radiusLongitude) ?? (userLongitude != null ? userLongitude : null);
    if (latitude == null || longitude == null) return null;
    return { latitude, longitude };
  }, [radiusLatitude, radiusLongitude, userLatitude, userLongitude]);

  useEffect(() => {
    if (!radiusCenter) return;
    const timer = setTimeout(() => {
      mapRef.current?.animateToRegion(
        regionForRadius(radiusCenter.latitude, radiusCenter.longitude, workRadiusMiles),
        350,
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [radiusCenter, workRadiusMiles]);

  const initialRegion = useMemo(() => {
    if (radiusCenter) return regionForRadius(radiusCenter.latitude, radiusCenter.longitude, workRadiusMiles);
    const coords = points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    if (userLatitude != null && userLongitude != null) {
      coords.push({ latitude: userLatitude, longitude: userLongitude });
    }
    return regionForPoints(coords);
  }, [fitKey, userLatitude, userLongitude, points, radiusCenter, workRadiusMiles]);

  if (!points.length) {
    return (
      <View style={styles.empty}>
        <Ionicons name="map-outline" size={28} color="#3f5b76" />
        <Text style={styles.emptyTitle}>No map pins yet</Text>
        <Text style={styles.emptySub}>These stops do not have GPS coordinates. Use the Stops view to work them.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        toolbarEnabled={false}
      >
        {radiusCenter && __DEV__
          ? DEV_RINGS.map((ring, index) => {
            const outer = ringPoints(radiusCenter.latitude, radiusCenter.longitude, ring.miles * MILES_TO_METERS);
            const innerMiles = index === 0 ? 0 : DEV_RINGS[index - 1].miles;
            const holes = innerMiles > 0
              ? [ringPoints(radiusCenter.latitude, radiusCenter.longitude, innerMiles * MILES_TO_METERS)]
              : undefined;
            return (
              <Polygon
                key={`dev-band-${ring.miles}`}
                coordinates={outer}
                holes={holes}
                strokeColor={ring.stroke}
                fillColor={ring.fill}
                strokeWidth={1}
              />
            );
          })
          : radiusCenter ? (
            <Circle
              center={radiusCenter}
              radius={workRadiusMiles * MILES_TO_METERS}
              strokeColor="rgba(37, 99, 235, 0.95)"
              fillColor="rgba(37, 99, 235, 0.08)"
              strokeWidth={2}
            />
          ) : null}
        {points.map((point) => {
          const current = point.loc.locationKey === activeLocationKey;
          const done = isStopDone(point.loc) && !current;
          const stopNo = point.index + 1;
          return (
            <Marker
              key={`${point.loc.locationKey}:${current ? 'now' : done ? 'done' : 'left'}`}
              coordinate={{ latitude: point.latitude, longitude: point.longitude }}
              onPress={() => {
                if (current) onOpenStop(point.loc);
              }}
              tappable={current}
              tracksViewChanges
              zIndex={current ? 3 : done ? 1 : 2}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View style={styles.pinWrap}>
                <View style={[styles.pinHead, current && styles.pinHeadNow]}>
                  {current ? <View style={styles.nowRing} /> : null}
                  <View style={[
                    styles.pin,
                    current && styles.pinCurrent,
                    done && styles.pinDone,
                    !current && !done && styles.pinLeft,
                  ]}>
                    <Text style={[
                      styles.pinText,
                      current && styles.pinTextNow,
                      done && styles.pinTextDone,
                      !current && !done && styles.pinTextLeft,
                    ]}>
                      {done ? '✓' : stopNo}
                    </Text>
                  </View>
                </View>
                <View style={[
                  styles.pinTail,
                  current && styles.pinTailCurrent,
                  done && styles.pinTailDone,
                  !current && !done && styles.pinTailLeft,
                ]} />
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={[styles.legend, missingCount > 0 && styles.legendBelow]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendNow]} />
          <Text style={styles.legendText}>Now</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendLeft]} />
          <Text style={styles.legendText}>Left</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDone]} />
          <Text style={styles.legendText}>Done</Text>
        </View>
        {__DEV__ ? null : (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.legendRadius]} />
            <Text style={styles.legendText}>{workRadiusMiles} mi</Text>
          </View>
        )}
      </View>

      {__DEV__ && radiusCenter ? (
        <View style={styles.devRings}>
          {DEV_BANDS.map((band, index) => {
            const previous = index === 0 ? 0 : DEV_BANDS[index - 1].max;
            const count = points.filter((point) => {
              const miles = milesBetween(radiusCenter, { latitude: point.latitude, longitude: point.longitude });
              if (miles > band.max) return false;
              return index === 0 ? miles >= 0 : miles > previous;
            }).length;
            return (
              <View key={band.label} style={styles.devRingRow}>
                <View style={[styles.legendDot, { backgroundColor: DEV_RINGS[index].fill, borderColor: DEV_RINGS[index].stroke }]} />
                <Text style={styles.devRingText}>{band.label} mi · {count}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {missingCount > 0 ? (
        <View style={styles.missingBanner}>
          <Text style={styles.missingText}>{missingCount} stop(s) have no GPS and are list-only.</Text>
        </View>
      ) : null}

      {active ? (
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>
            {active.flyers.length
              ? `Drop ${active.flyers.length} flyer${active.flyers.length === 1 ? '' : 's'}`
              : 'Current stop'}
          </Text>
          <Text style={styles.sheetSub}>
            Stop {Math.max(stops.findIndex((stop) => stop.locationKey === active.locationKey) + 1, 1)} of {stops.length}
          </Text>
          <View style={styles.stopBlock}>
            <View style={[styles.numBubble, isStopDone(active) && styles.numBubbleDone]}>
              <Text style={[styles.numText, isStopDone(active) && styles.numTextDone]}>
                {isStopDone(active) ? '✓' : Math.max(stops.findIndex((s) => s.locationKey === active.locationKey) + 1, 1)}
              </Text>
            </View>
            <View style={styles.stopCopy}>
              <Text style={styles.street} numberOfLines={2}>
                {active.addressStreet?.trim() || locationTitle(active) || 'Address pending'}
              </Text>
              {locationTitle(active) && locationTitle(active) !== active.addressStreet?.trim() ? (
                <Text style={styles.place} numberOfLines={1}>{locationTitle(active)}</Text>
              ) : null}
              <Text style={styles.meta}>
                {formatDistance(milesToStop(active) ?? active.liveDistanceMiles ?? active.distanceMiles ?? null)} away
                {isStopDone(active) ? ' · Done' : ''}
              </Text>
            </View>
          </View>
          <Pressable style={styles.openBtn} onPress={() => onOpenStop(active)}>
            <Text style={styles.openBtnText}>Open stop</Text>
          </Pressable>
          <Pressable style={styles.navBtn} onPress={onNavigate}>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={styles.navBtnText}>Navigate</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#e2e8f0' },
  map: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#fff',
  },
  emptyTitle: { color: '#0f172a', fontSize: 18, fontWeight: '900', marginTop: 12 },
  emptySub: { color: '#64748b', fontSize: 13, fontWeight: '600', marginTop: 6, textAlign: 'center', lineHeight: 20 },
  pinWrap: { alignItems: 'center' },
  pinHead: { alignItems: 'center', justifyContent: 'center' },
  pinHeadNow: { width: 46, height: 46 },
  nowRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
  },
  pin: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
  },
  pinCurrent: { backgroundColor: '#1d4ed8', minWidth: 36, height: 36, borderRadius: 18, borderColor: '#fff' },
  pinDone: { backgroundColor: '#16a34a', borderColor: '#fff' },
  pinLeft: { backgroundColor: '#fff', borderColor: '#64748b' },
  pinTail: {
    width: 8,
    height: 8,
    marginTop: -5,
    backgroundColor: '#fff',
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#64748b',
    transform: [{ rotate: '45deg' }],
  },
  pinTailCurrent: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  pinTailDone: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  pinTailLeft: { backgroundColor: '#fff', borderColor: '#64748b' },
  pinText: { fontSize: 12, fontWeight: '800' },
  pinTextNow: { color: '#fff', fontSize: 15 },
  pinTextDone: { color: '#fff', fontSize: 14 },
  pinTextLeft: { color: '#0f172a' },
  legend: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  legendBelow: { top: 48 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  legendNow: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  legendLeft: { backgroundColor: '#fff', borderColor: '#64748b' },
  legendDone: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  legendRadius: { backgroundColor: 'rgba(37, 99, 235, 0.12)', borderColor: '#2563eb' },
  devRings: {
    position: 'absolute',
    top: 52,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  devRingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  devRingText: { color: '#0f172a', fontSize: 11, fontWeight: '800' },
  legendText: { color: '#0f172a', fontSize: 12, fontWeight: '800' },
  missingBanner: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  missingText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginBottom: 12,
  },
  sheetTitle: { color: '#111827', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  sheetSub: { color: '#6b7280', fontSize: 14, fontWeight: '500', marginTop: 2 },
  stopBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  numBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#3f5b76',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  numBubbleDone: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  numText: { color: '#3f5b76', fontSize: 13, fontWeight: '800' },
  numTextDone: { color: '#fff' },
  stopCopy: { flex: 1, minWidth: 0 },
  street: { color: '#111827', fontSize: 17, fontWeight: '700', lineHeight: 22 },
  place: { color: '#4b5563', fontSize: 14, fontWeight: '500', marginTop: 2 },
  meta: { color: '#6b7280', fontSize: 13, fontWeight: '500', marginTop: 4 },
  openBtn: {
    marginTop: 16,
    backgroundColor: '#3f5b76',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  openBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  navBtn: {
    marginTop: 8,
    backgroundColor: '#e86a92',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  navBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
