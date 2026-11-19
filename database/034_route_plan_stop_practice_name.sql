-- Practice name typed by the distributor at a route stop.
-- Kept separate from StopLabel, which can be a doctor/provider name for unmapped stops.
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'PracticeNameEntered') IS NULL
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
    ADD PracticeNameEntered NVARCHAR(300) NULL;
END;
GO
