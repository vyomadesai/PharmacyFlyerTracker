/*
  Per-flyer distribution reset interval for route-planner campaigns.
  Doctors who received this flyer within FrequencyInDays are excluded from matching.
*/

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FrequencyInDays') IS NULL
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_Campaign
    ADD FrequencyInDays INT NULL;
END;
GO
