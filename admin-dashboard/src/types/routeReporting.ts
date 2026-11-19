export type MapRouteStop = {
  RouteStopId: number;
  RouteId: number;
  StopOrder: number;
  StopLabel?: string | null;
  StopAddress?: string | null;
  Latitude: number | string;
  Longitude: number | string;
  TargetType?: string | null;
  NPI?: string | null;
  AssignedFlyerName?: string | null;
  StopStatus?: string | null;
  RouteName?: string | null;
  RouteDate?: string | null;
  CampaignId?: number | null;
  CampaignName?: string | null;
  DistributorName?: string | null;
  MarketName?: string | null;
  HasProof?: boolean | number | null;
  LocationVerified?: boolean | number | null;
};

export function getRouteStopCoords(stop: MapRouteStop) {
  const lat = Number(stop.Latitude);
  const lng = Number(stop.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function routeStopStatusColor(status?: string | null) {
  const value = String(status || 'pending').toLowerCase();
  if (value === 'completed') return '#16a34a';
  if (value === 'arrived') return '#2563eb';
  if (value === 'skipped' || value === 'failed') return '#dc2626';
  return '#64748b';
}

export type RouteWorkflowDashboard = {
  targets?: {
    SuggestedTargets?: number;
    ApprovedTargets?: number;
    RejectedTargets?: number;
    AssignedTargets?: number;
    CompletedTargets?: number;
  };
  stops?: {
    CompletedDrops?: number;
    PendingDrops?: number;
    SkippedFailedDrops?: number;
    TotalRouteStops?: number;
  };
  inventory?: {
    AssignedFlyers?: number;
    DeliveredFlyers?: number;
    RemainingFlyers?: number;
  };
  routes?: {
    TotalRoutes?: number;
    RoutesCompleted?: number;
    RoutesActive?: number;
  };
  completionPercentage?: number;
};

export type DashboardResponse = {
  TotalDeliveries?: number;
  DeliveriesToday?: number;
  FlyersDelivered?: number;
  InterestedCount?: number;
  ActiveStaffCount?: number;
  routeWorkflow?: RouteWorkflowDashboard;
};
