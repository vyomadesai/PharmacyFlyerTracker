'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';

type Dashboard = { TotalDeliveries: number; DeliveriesToday: number; FlyersDelivered: number; InterestedCount: number; ActiveStaffCount: number; PendingApprovalCount?: number; OpenAssignmentCount?: number; RoutesToday?: number; DueVisitCount?: number };

type Kpi = { label: string; value: number | undefined; hint: string; accent: string };

const QUICK_LINKS = [
  { href: '/campaign-builder', title: 'Flyer Builder', text: 'Create flyers and their doctor specialty rules.' },
  { href: '/route-planner', title: 'Route Planner', text: 'Set the coverage centroid, radius and visit frequency.' },
  { href: '/flyers-assigned', title: 'Check-ins', text: 'See who checked in and which flyers were on their route.' },
  { href: '/deliveries', title: 'Deliveries', text: 'Every flyer drop with GPS, status and proof photo.' },
  { href: '/map', title: 'Delivery Map', text: 'Trace rep stops on the map and open photos.' },
  { href: '/npi-registery', title: 'NPI Registry', text: 'Compare Master_Doctor with NPI registry records.' },
];

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get('/reports/dashboard')
      .then(r => setData(r.data))
      .catch((err: any) => {
        if (err?.response?.status !== 401) setError(err?.response?.data?.message || 'Could not load dashboard totals.');
      });
  }, []);

  const deliveryKpis: Kpi[] = [
    { label: 'Total Deliveries', value: data?.TotalDeliveries, hint: 'All flyer drops recorded', accent: '#2563eb' },
    { label: 'Today', value: data?.DeliveriesToday, hint: 'Deliveries today (Florida time)', accent: '#0891b2' },
    { label: 'Flyers Delivered', value: data?.FlyersDelivered, hint: 'Marked as flyer handed over', accent: '#16a34a' },
    { label: 'Interested', value: data?.InterestedCount, hint: 'Response marked interested', accent: '#7c3aed' },
    { label: 'Active Staff', value: data?.ActiveStaffCount, hint: 'Reps with at least one delivery', accent: '#f59e0b' },
  ];

  const assignmentKpis: Kpi[] = [
    { label: 'Pending Approvals', value: data?.PendingApprovalCount, hint: 'Suggested assignments', accent: '#94a3b8' },
    { label: 'Open Assignments', value: data?.OpenAssignmentCount, hint: 'Approved, not completed', accent: '#94a3b8' },
    { label: 'Routes Today', value: data?.RoutesToday, hint: 'Assignment routes dated today', accent: '#94a3b8' },
    { label: 'Visits Due', value: data?.DueVisitCount, hint: 'Assignment follow-ups due', accent: '#94a3b8' },
  ];

  function renderKpis(items: Kpi[]) {
    return (
      <div className="kpi-grid">
        {items.map((k) => (
          <div className="kpi-card" key={k.label} style={{ ['--kpi-accent' as any]: k.accent }}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">
              {data || error ? (k.value ?? '-') : <span className="kpi-skeleton" />}
            </span>
            <span className="kpi-hint">{k.hint}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        subtitle="Live totals from field deliveries recorded through the mobile app."
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      <p className="section-label">Field deliveries</p>
      {renderKpis(deliveryKpis)}

      <p className="section-label" style={{ marginTop: 24 }}>
        Assignment workflow <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(older assignment tables — not used by Smart Route check-in)</span>
      </p>
      {renderKpis(assignmentKpis)}

      <p className="section-label" style={{ marginTop: 24 }}>Quick links</p>
      <div className="quick-links">
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className="quick-link">
            <strong>{q.title}</strong>
            <span>{q.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
