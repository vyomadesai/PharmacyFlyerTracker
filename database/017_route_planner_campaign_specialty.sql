/*
  Isolated route-planner campaign ↔ specialty rules (V2).
  Does not alter dbo.PharmacyFlyer_CampaignSpecialtyMapping used by legacy workflow.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_CampaignSpecialtyV2 (
    CampaignSpecialtyV2Id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_CampaignSpecialtyV2 PRIMARY KEY,
    CampaignId INT NOT NULL,
    SpecialityRecID INT NULL,
    SpecialityCode NVARCHAR(50) NULL,
    Description NVARCHAR(300) NULL,
    MatchLevel VARCHAR(10) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_MatchLevel DEFAULT 'any',
    MatchMode VARCHAR(30) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_MatchMode DEFAULT 'primary_or_secondary',
    IsActive BIT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_IsActive DEFAULT 1,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_CreatedDate DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_CampaignSpecialtyV2_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignSpecialtyV2_CampaignId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyV2')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignSpecialtyV2_CampaignId
  ON dbo.PharmacyFlyer_CampaignSpecialtyV2 (CampaignId, IsActive);
END;
GO
