/*
  Org visit grouping for Add New entries (one flyer per org + provider discovery rows).
*/

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'VisitBatchId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD VisitBatchId UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'OrganizationNpi') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD OrganizationNpi VARCHAR(20) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'IsOrgFlyerRow') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD IsOrgFlyerRow BIT NOT NULL
    CONSTRAINT DF_PharmacyFlyer_APPNewEntries_IsOrgFlyerRow DEFAULT 0;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPNewEntries_VisitBatch'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries')
)
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_VisitBatch
  ON dbo.PharmacyFlyer_APPNewEntries (VisitBatchId, SubmittedAt DESC);
GO
