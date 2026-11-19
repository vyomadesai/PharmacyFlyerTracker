/*
  Link provider candidate rows and photos to physical stops.
*/

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'PhysicalStopId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD PhysicalStopId UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'VerificationStatus') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD VerificationStatus NVARCHAR(50) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPNewEntries_PhysicalStop'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries')
)
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_PhysicalStop
  ON dbo.PharmacyFlyer_APPNewEntries (PhysicalStopId, SubmittedAt DESC);
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntryPhoto', 'PhysicalStopId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntryPhoto ADD PhysicalStopId UNIQUEIDENTIFIER NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntryPhoto')
    AND name = 'AppNewEntryId' AND is_nullable = 0
)
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntryPhoto ALTER COLUMN AppNewEntryId BIGINT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPNewEntryPhoto_PhysicalStop'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntryPhoto')
)
  CREATE INDEX IX_PharmacyFlyer_APPNewEntryPhoto_PhysicalStop
  ON dbo.PharmacyFlyer_APPNewEntryPhoto (PhysicalStopId, CreatedDate DESC);
GO
