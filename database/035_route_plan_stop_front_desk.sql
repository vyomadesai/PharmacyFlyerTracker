-- Front-desk notes collected by the distributor at each route stop.
-- Idempotent. The backend also adds these columns lazily on first use
-- (routeThreeEnrichment.ts -> ensureFrontDeskColumns).

IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskOutcome') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskOutcome NVARCHAR(40) NULL;        -- accepted | left_at_desk | refused | closed | wrong_address
GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'BestTimeToVisit') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD BestTimeToVisit NVARCHAR(40) NULL;         -- morning | midday | afternoon
GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskContactName') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskContactName NVARCHAR(200) NULL;   -- who to ask for next time
GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskNote') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskNote NVARCHAR(1000) NULL;
GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskUpdatedAt') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskUpdatedAt DATETIME2 NULL;
GO
