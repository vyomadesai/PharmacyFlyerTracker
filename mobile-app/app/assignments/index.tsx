import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import { api } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

type FlyerGroup = {
  campaignId: number;
  campaignName: string;
  flyers: Array<{
    flyerName: string;
    assignedQuantity: number;
    deliveredQuantity: number;
    remainingQuantity: number;
    status: string;
  }>;
};

type AssignmentsSummary = {
  capacity: number;
  totalAssignedToday: number;
  totalDeliveredToday: number;
  totalRemainingToday: number;
  flyersByCampaign: FlyerGroup[];
};

function getPercent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

function isDeliveredStatus(status: string) {
  const normalized = String(status || '').toLowerCase();
  return ['delivered', 'completed', 'complete', 'done'].includes(normalized);
}

export default function AssignmentsScreen() {
  const router = useRouter();

  const [summary, setSummary] = useState<AssignmentsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const res = await api.get('/routes/my/assignments');
      setSummary(res.data);
    } catch (_e: any) {
      try {
        const today = await api.get('/client-workflow/routes/today');
        const stops = today.data?.stops || [];

        const grouped = new Map<number, FlyerGroup>();

        let deliveredCount = 0;
        let remainingCount = 0;
        let totalFlyers = 0;

        // Each location stop now carries a `flyers` list (one per campaign). Today's
        // route only returns remaining work, so every listed flyer is still pending.
        for (const stop of stops) {
          const flyers = Array.isArray(stop.flyers) ? stop.flyers : [];
          for (const flyer of flyers) {
            const campaignId = Number(flyer.CampaignId || 0);
            const campaignName = flyer.CampaignName || 'Assigned campaign';
            const flyerName = flyer.FlyerTitle || flyer.FlyerIdentifier || campaignName;
            const status = 'assigned';

            const remaining = 1;
            totalFlyers += 1;
            remainingCount += remaining;

            if (!grouped.has(campaignId)) {
              grouped.set(campaignId, { campaignId, campaignName, flyers: [] });
            }
            const group = grouped.get(campaignId)!;
            const found = group.flyers.find((f) => f.flyerName === flyerName);
            if (found) {
              found.assignedQuantity += 1;
              found.remainingQuantity += remaining;
            } else {
              group.flyers.push({
                flyerName,
                assignedQuantity: 1,
                deliveredQuantity: 0,
                remainingQuantity: remaining,
                status
              });
            }
          }
        }

        setSummary({
          capacity: totalFlyers,
          totalAssignedToday: totalFlyers,
          totalDeliveredToday: deliveredCount,
          totalRemainingToday: remainingCount,
          flyersByCampaign: Array.from(grouped.values())
        });
      } catch (e: any) {
        setError(e?.response?.data?.message || 'Could not load assignments.');
      }
    } finally {
      setLoading(false);
    }
  }

  function goToRemainingRoute(
    group: FlyerGroup,
    flyer: FlyerGroup['flyers'][number]
  ) {
    if (flyer.remainingQuantity <= 0) return;

    router.push({
      pathname: '/route',
      params: {
        campaignId: String(group.campaignId),
        flyerName: flyer.flyerName,
        onlyRemaining: '1'
      }
    });
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const assigned = summary?.totalAssignedToday || 0;
  const delivered = summary?.totalDeliveredToday || 0;
  const remaining = summary?.totalRemainingToday || 0;
  const capacity = summary?.capacity || 0;

  const deliveredPercent = getPercent(delivered, assigned);
  const capacityPercent = getPercent(assigned, capacity);

  return (
    <View style={shared.screen}>
      <DistributorNav />

      <ScrollView
        contentContainerStyle={[shared.content, styles.content]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} />
        }
      >
      

        {error ? (
          <View style={styles.errorCard}>
            <Text style={shared.error}>{error}</Text>
          </View>
        ) : null}

        {loading && !summary ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading your assignments...</Text>
          </View>
        ) : null}

        {summary ? (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <View>
                  <Text style={styles.summaryLabel}>Today’s Work</Text>
                  <Text style={styles.summaryTitle}>
                    {assigned} Flyers Assigned
                  </Text>
                </View>

                <View style={styles.percentBadge}>
                  <Text style={styles.percentText}>{deliveredPercent}%</Text>
                  <Text style={styles.percentLabel}>done</Text>
                </View>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${deliveredPercent}%` }
                  ]}
                />
              </View>

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{assigned}</Text>
                  <Text style={styles.statLabel}>Assigned</Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{delivered}</Text>
                  <Text style={styles.statLabel}>Delivered</Text>
                </View>

                <Pressable
                  disabled={remaining <= 0}
                  onPress={() => {
                    const firstGroupWithRemaining =
                      summary.flyersByCampaign.find((group) =>
                        group.flyers.some(
                          (flyer) => flyer.remainingQuantity > 0
                        )
                      );

                    const firstFlyerWithRemaining =
                      firstGroupWithRemaining?.flyers.find(
                        (flyer) => flyer.remainingQuantity > 0
                      );

                    if (
                      firstGroupWithRemaining &&
                      firstFlyerWithRemaining
                    ) {
                      goToRemainingRoute(
                        firstGroupWithRemaining,
                        firstFlyerWithRemaining
                      );
                    }
                  }}
                  style={[
                    styles.statBox,
                    styles.remainingStatBox,
                    remaining <= 0 ? styles.disabledStatBox : null
                  ]}
                >
                  <Text style={styles.statValue}>{remaining}</Text>
                  <Text style={styles.statLabel}>Remaining</Text>
                  {remaining > 0 ? (
                    <Text style={styles.tapHint}>Tap to route</Text>
                  ) : null}
                </Pressable>
              </View>

              <View style={styles.capacityBox}>
                <View style={styles.capacityHeader}>
                  <Text style={styles.capacityTitle}>Capacity</Text>
                  <Text style={styles.capacityText}>
                    {assigned} / {capacity || assigned}
                  </Text>
                </View>

                <View style={styles.capacityTrack}>
                  <View
                    style={[
                      styles.capacityFill,
                      { width: `${capacityPercent || 100}%` }
                    ]}
                  />
                </View>
              </View>
            </View>

          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32
  },

  header: {
    marginBottom: 16
  },

  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827'
  },

  pageSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6B7280'
  },

  loadingBox: {
    paddingVertical: 32,
    alignItems: 'center'
  },

  loadingText: {
    marginTop: 10,
    color: '#6B7280',
    fontSize: 14
  },

  errorCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14
  },

  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    marginBottom: 16
  },

  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16
  },

  summaryLabel: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
    marginBottom: 4
  },

  summaryTitle: {
    fontSize: 24,
    color: '#111827',
    fontWeight: '800'
  },

  percentBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center'
  },

  percentText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#047857'
  },

  percentLabel: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '700',
    textTransform: 'uppercase'
  },

  progressTrack: {
    height: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 16
  },

  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 999
  },

  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: -4,
    marginBottom: 16
  },

  statBox: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EEF2F7'
  },

  remainingStatBox: {
    backgroundColor: '#EFF6FF',
    borderColor: colors.primary
  },

  disabledStatBox: {
    backgroundColor: '#F9FAFB',
    borderColor: '#EEF2F7'
  },

  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827'
  },

  statLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600'
  },

  tapHint: {
    marginTop: 4,
    fontSize: 10,
    color: colors.primary,
    fontWeight: '800',
    textTransform: 'uppercase'
  },

  capacityBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB'
  },

  capacityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8
  },

  capacityTitle: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '700'
  },

  capacityText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '700'
  },

  capacityTrack: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    overflow: 'hidden'
  },

  capacityFill: {
    height: '100%',
    backgroundColor: '#111827',
    borderRadius: 999
  },

  campaignCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 14
  },

  campaignName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827'
  },

  campaignSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: '#6B7280'
  },

  flyerRow: {
    borderTopWidth: 1,
    borderTopColor: '#EEF2F7',
    paddingTop: 14,
    marginTop: 14
  },

  firstFlyerRow: {
    borderTopWidth: 0
  },

  flyerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between'
  },

  flyerNameBox: {
    flex: 1,
    paddingRight: 10
  },

  flyerName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827'
  },

  flyerMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B7280'
  },

  statusPill: {
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10
  },

  statusText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '800',
    textTransform: 'uppercase'
  },

  flyerProgressTrack: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 12
  },

  flyerProgressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 999
  },

  flyerStats: {
    flexDirection: 'row',
    marginTop: 12,
    marginHorizontal: -4
  },

  flyerStatBox: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EEF2F7'
  },

  flyerStatValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827'
  },

  flyerStatLabel: {
    marginTop: 3,
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '700'
  },

  flyerRemainingButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginHorizontal: 4,
    alignItems: 'center'
  },

  flyerRemainingButtonDisabled: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB'
  },

  flyerRemainingValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF'
  },

  flyerRemainingValueDisabled: {
    color: '#9CA3AF'
  },

  flyerRemainingLabel: {
    marginTop: 3,
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '800'
  },

  flyerRemainingLabelDisabled: {
    color: '#9CA3AF'
  },

  goRouteText: {
    marginTop: 4,
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '900',
    textTransform: 'uppercase'
  },

  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB'
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827'
  },

  emptyText: {
    marginTop: 6,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center'
  }
});