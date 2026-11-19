/*
  Flyer campaign targeting/config rules.

  Extends dbo.PharmacyFlyer_Campaign without altering existing campaign behavior.
  dbo.PharmacyFlyer_CampaignSpecialtyMapping remains for legacy specialty -> flyer mapping.
  New configs support richer targeting for future approval/assignment workflows.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_CampaignConfig (
    CampaignConfigId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_CampaignConfig PRIMARY KEY,
    CampaignId INT NOT NULL,
    ConfigName NVARCHAR(200) NOT NULL,
    TargetType VARCHAR(20) NOT NULL,
    FlyerName NVARCHAR(200) NULL,
    DoctorType VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_DoctorType DEFAULT 'any',
    SpecialtySource VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_SpecialtySource DEFAULT 'any',
    SpecialtyValue NVARCHAR(300) NULL,
    CustomSpecialtyText NVARCHAR(300) NULL,
    TaxonomyCode VARCHAR(20) NULL,
    RequirePrimaryTaxonomy BIT NULL,
    MarketId INT NULL,
    CenterAddress NVARCHAR(300) NULL,
    CenterLatitude DECIMAL(10, 7) NULL,
    CenterLongitude DECIMAL(10, 7) NULL,
    RadiusMiles DECIMAL(8, 2) NULL,
    VisitFrequencyType VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_VisitFrequencyType DEFAULT 'one_time',
    VisitFrequencyDays INT NULL,
    CheckInRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_CheckInRequired DEFAULT 1,
    ProofUploadRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_ProofUploadRequired DEFAULT 1,
    ApprovalRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_ApprovalRequired DEFAULT 1,
    IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_IsActive DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignConfig_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_CampaignConfig_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
    CONSTRAINT FK_PharmacyFlyer_CampaignConfig_Market
      FOREIGN KEY (MarketId) REFERENCES dbo.PharmacyFlyer_Market(MarketId),
    CONSTRAINT CK_PharmacyFlyer_CampaignConfig_TargetType
      CHECK (TargetType IN ('doctor', 'pharmacy', 'both')),
    CONSTRAINT CK_PharmacyFlyer_CampaignConfig_DoctorType
      CHECK (DoctorType IN ('primary_care', 'specialist', 'any')),
    CONSTRAINT CK_PharmacyFlyer_CampaignConfig_SpecialtySource
      CHECK (SpecialtySource IN ('backend', 'custom', 'any')),
    CONSTRAINT CK_PharmacyFlyer_CampaignConfig_VisitFrequencyType
      CHECK (VisitFrequencyType IN ('one_time', 'weekly', 'biweekly', 'monthly', 'custom_days'))
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignConfig_CampaignId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignConfig_CampaignId
  ON dbo.PharmacyFlyer_CampaignConfig (CampaignId, IsActive);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignConfig_TargetType'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignConfig_TargetType
  ON dbo.PharmacyFlyer_CampaignConfig (TargetType, IsActive);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignConfig_MarketId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignConfig_MarketId
  ON dbo.PharmacyFlyer_CampaignConfig (MarketId, IsActive);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignConfig_SpecialtyValue'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignConfig_SpecialtyValue
  ON dbo.PharmacyFlyer_CampaignConfig (SpecialtyValue, IsActive);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignConfig_TaxonomyCode'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignConfig_TaxonomyCode
  ON dbo.PharmacyFlyer_CampaignConfig (TaxonomyCode, IsActive);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignConfig_IsActive'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignConfig_IsActive
  ON dbo.PharmacyFlyer_CampaignConfig (IsActive, CampaignId);
END;
GO
