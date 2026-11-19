/*
  Flyer drop fields for Add New entries.
*/

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'TaxonomyCode') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD TaxonomyCode VARCHAR(20) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'PrimaryTaxonomy') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD PrimaryTaxonomy NVARCHAR(10) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'SelectedTaxonomy') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD SelectedTaxonomy NVARCHAR(255) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'TaxonomyState') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD TaxonomyState VARCHAR(10) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'LicenseNumber') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD LicenseNumber NVARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'CampaignId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD CampaignId INT NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'FlyerTitle') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD FlyerTitle NVARCHAR(200) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'FlyerDropped') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries ADD FlyerDropped BIT NOT NULL
    CONSTRAINT DF_PharmacyFlyer_APPNewEntries_FlyerDropped DEFAULT 0;
GO
