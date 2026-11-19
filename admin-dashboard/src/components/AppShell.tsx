'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { clearStoredAuth, getStoredUser, type AuthUser } from '../utils/auth';

/** Pages rendered without the sidebar (login / access denied). */
const PUBLIC_PATHS = new Set(['/', '/access-denied']);

type NavItem = { href: string; label: string; icon: ReactNode };
type NavGroup = { label: string; items: NavItem[] };

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const Icons = {
  dashboard: (
    <svg {...ICON_PROPS}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  flyer: (
    <svg {...ICON_PROPS}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 16h6" /></svg>
  ),
  territory: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>
  ),
  checkin: (
    <svg {...ICON_PROPS}><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><path d="M9.5 10l1.8 1.8L14.8 8.3" /></svg>
  ),
  deliveries: (
    <svg {...ICON_PROPS}><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></svg>
  ),
  entries: (
    <svg {...ICON_PROPS}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M18 8v6M15 11h6" /></svg>
  ),
  map: (
    <svg {...ICON_PROPS}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>
  ),
  registry: (
    <svg {...ICON_PROPS}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /><path d="M11 8v3l2 1.5" /></svg>
  ),
  reports: (
    <svg {...ICON_PROPS}><path d="M4 20h16" /><path d="M7 16V10M12 16V5M17 16v-7" /></svg>
  ),
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: Icons.dashboard }],
  },
  {
    label: 'Planning',
    items: [
      /* Hidden for now:
      { href: '/campaigns', label: 'Campaigns' }, */
      { href: '/campaign-builder', label: 'Flyer Builder', icon: Icons.flyer },
      { href: '/route-planner', label: 'Route Planner', icon: Icons.territory },
      /* Hidden for now:
      { href: '/routes-available', label: 'Routes Available' },
      { href: '/workflow', label: 'Route Planning' },
      { href: '/available-routes', label: 'Available Routes' }, */
    ],
  },
  {
    label: 'Field activity',
    items: [
      { href: '/flyers-assigned', label: 'Check-ins', icon: Icons.checkin },
      { href: '/deliveries', label: 'Deliveries', icon: Icons.deliveries },
      { href: '/new-entries', label: 'New Entries', icon: Icons.entries },
      { href: '/map', label: 'Delivery Map', icon: Icons.map },
    ],
  },
  {
    label: 'Data & reports',
    items: [
      { href: '/npi-registery', label: 'NPI Registry', icon: Icons.registry },
      { href: '/reports', label: 'Reports', icon: Icons.reports },
    ],
  },
];

function initials(user: AuthUser | null) {
  const name = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, [pathname]);

  if (PUBLIC_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  const displayName =
    user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Admin user';

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link href="/dashboard" className="app-brand">
          <span className="app-brand-mark">MDP</span>
          <span className="app-brand-text">
            <strong>Flyer Tracker</strong>
            <span>Admin console</span>
          </span>
        </Link>

        <nav className="app-nav" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div className="app-nav-group" key={group.label}>
              <div className="app-nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`app-nav-link${isActive(pathname, item.href) ? ' is-active' : ''}`}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-user">
            <span className="app-user-avatar">{initials(user)}</span>
            <span className="app-user-meta">
              <strong title={displayName}>{displayName}</strong>
              <span>{user?.role || 'signed in'}</span>
            </span>
          </div>
          <button
            type="button"
            className="app-logout btn-sm"
            onClick={() => {
              clearStoredAuth();
              router.replace('/');
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      <div className="app-content">
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
