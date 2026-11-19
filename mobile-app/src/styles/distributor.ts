import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
  primary: '#3f5b76',
  primaryDark: '#2c4458',
  accent: '#e86a92',
  warning: '#b45309',
  danger: '#b91c1c',
  success: '#16a34a',
};

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1, width: '100%' },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 4, flexShrink: 1 },
  subtitle: { fontSize: 15, color: colors.muted, marginBottom: 16, flexShrink: 1, lineHeight: 22 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 },
  meta: { fontSize: 14, color: colors.muted, marginTop: 4 },
  flyerHighlight: { fontSize: 17, fontWeight: '700', color: colors.primary, marginVertical: 6 },
  error: { color: colors.danger, marginBottom: 12 },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 6,
  },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
});

export function statusBadgeStyle(status?: string) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'completed') return { backgroundColor: '#dcfce7', color: colors.success };
  if (normalized === 'arrived') return { backgroundColor: '#e8eef3', color: '#3f5b76' };
  if (normalized === 'skipped' || normalized === 'failed') return { backgroundColor: '#fee2e2', color: colors.danger };
  if (normalized === 'overdue') return { backgroundColor: '#ffedd5', color: colors.warning };
  return { backgroundColor: '#f1f5f9', color: colors.muted };
}
