/*
  Reconcile workflow/mobile assignment counts and restrict doctor suggestion seed data
  to Pinellas Park, FL and St. Petersburg, FL.

  Safe to re-run. The DELETE section resets only generated workflow/inventory rows,
  so existing campaigns/users remain intact. Run this if old out-of-area/demo data
  is causing count drift after deploying the code changes.
*/

BEGIN TRANSACTION;

/* Clear generated route/inventory/workflow rows in dependency order. */
IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_RouteStopProof;

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_RouteStopCheckIn;

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_RouteStop;

IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_Route;

IF OBJECT_ID('dbo.PharmacyFlyer_Assignment', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_Assignment;

IF OBJECT_ID('dbo.PharmacyFlyer_DistributorBatchStop', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_DistributorBatchStop;

IF OBJECT_ID('dbo.PharmacyFlyer_DistributorInventory', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_DistributorInventory;

IF OBJECT_ID('dbo.PharmacyFlyer_DistributorAssignmentBatch', 'U') IS NOT NULL
  DELETE FROM dbo.PharmacyFlyer_DistributorAssignmentBatch;

/* Deactivate old targeting rules outside the requested doctor locations. */
IF OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NOT NULL
BEGIN
  UPDATE dbo.PharmacyFlyer_TargetingRule
  SET IsActive = 0,
      LastModifiedDate = SYSDATETIME()
  WHERE TargetType = 'Doctor'
    AND UPPER(LTRIM(RTRIM(ISNULL(TargetCity, '')))) NOT IN ('PINELLAS PARK', 'ST. PETERSBURG', 'ST PETERSBURG');
END;

DECLARE @DefaultCampaignId INT = (
  SELECT TOP 1 CampaignId
  FROM dbo.PharmacyFlyer_Campaign
  WHERE IsActive = 1
  ORDER BY CreatedDate DESC, CampaignId DESC
);

IF @DefaultCampaignId IS NOT NULL AND OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dbo.PharmacyFlyer_TargetingRule
    WHERE ConfigName = 'Doctors around Pinellas Park' AND CampaignId = @DefaultCampaignId
  )
  BEGIN
    INSERT INTO dbo.PharmacyFlyer_TargetingRule (
      CampaignId, ConfigName, TargetType, TargetCity, TargetState,
      RadiusMiles, VisitFrequencyDays, CheckInRequired, ProofRequired, IsActive
    )
    VALUES (
      @DefaultCampaignId, 'Doctors around Pinellas Park', 'Doctor', 'Pinellas Park', 'FL',
      25, 30, 1, 1, 1
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM dbo.PharmacyFlyer_TargetingRule
    WHERE ConfigName = 'Doctors around St. Petersburg' AND CampaignId = @DefaultCampaignId
  )
  BEGIN
    INSERT INTO dbo.PharmacyFlyer_TargetingRule (
      CampaignId, ConfigName, TargetType, TargetCity, TargetState,
      RadiusMiles, VisitFrequencyDays, CheckInRequired, ProofRequired, IsActive
    )
    VALUES (
      @DefaultCampaignId, 'Doctors around St. Petersburg', 'Doctor', 'St. Petersburg', 'FL',
      25, 30, 1, 1, 1
    );
  END;
END;

COMMIT TRANSACTION;
