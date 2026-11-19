/*
  Suggested campaign doctor targets (references Master_Doctor, no doctor duplication).
*/

IF OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_CampaignTarget (
    CampaignTargetId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_CampaignTarget PRIMARY KEY,
    CampaignId INT NOT NULL,
    CampaignConfigId INT NULL,
    DoctorId INT NOT NULL,
    NPI VARCHAR(10) NULL,
    TargetStatus VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_TargetStatus DEFAULT 'suggested',
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_CampaignTarget_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
    CONSTRAINT FK_PharmacyFlyer_CampaignTarget_Config
      FOREIGN KEY (CampaignConfigId) REFERENCES dbo.PharmacyFlyer_CampaignConfig(CampaignConfigId),
    CONSTRAINT CK_PharmacyFlyer_CampaignTarget_TargetStatus
      CHECK (TargetStatus IN ('suggested', 'approved', 'rejected')),
    CONSTRAINT UQ_PharmacyFlyer_CampaignTarget_Config_Doctor
      UNIQUE (CampaignConfigId, DoctorId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_CampaignId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_CampaignId
  ON dbo.PharmacyFlyer_CampaignTarget (CampaignId, TargetStatus);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_DoctorId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_DoctorId
  ON dbo.PharmacyFlyer_CampaignTarget (DoctorId, NPI);
END;
GO
