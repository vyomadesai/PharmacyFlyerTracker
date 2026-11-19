/*
  Isolated route plan persistence (V2) for the new route-planner module.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_RoutePlanV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RoutePlanV2 (
    RoutePlanId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_RoutePlanV2 PRIMARY KEY,
    RouteName NVARCHAR(200) NOT NULL,
    CampaignId INT NULL,
    StartType VARCHAR(20) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_StartType DEFAULT 'custom',
    StartLabel NVARCHAR(300) NULL,
    StartLatitude DECIMAL(10, 7) NULL,
    StartLongitude DECIMAL(10, 7) NULL,
    RadiusMiles DECIMAL(8, 2) NULL,
    Status VARCHAR(20) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_Status DEFAULT 'draft',
    AssignedUserId INT NULL,
    PlanDate DATE NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_PlanDate DEFAULT (CAST(SYSDATETIME() AS DATE)),
    CreatedBy INT NULL,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_CreatedDate DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_RoutePlanV2_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RoutePlanStopV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RoutePlanStopV2 (
    RoutePlanStopId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_RoutePlanStopV2 PRIMARY KEY,
    RoutePlanId BIGINT NOT NULL,
    StopOrder INT NOT NULL,
    LocationKey NVARCHAR(200) NULL,
    PracticeId INT NULL,
    LocationId INT NULL,
    StopLabel NVARCHAR(300) NULL,
    AddressStreet NVARCHAR(300) NULL,
    AddressCity NVARCHAR(100) NULL,
    AddressState NVARCHAR(50) NULL,
    AddressZip NVARCHAR(20) NULL,
    Latitude DECIMAL(10, 7) NULL,
    Longitude DECIMAL(10, 7) NULL,
    DistanceMiles DECIMAL(8, 2) NULL,
    Status VARCHAR(20) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RoutePlanStopV2_Status DEFAULT 'pending',
    CompletedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_RoutePlanStopV2_Plan
      FOREIGN KEY (RoutePlanId) REFERENCES dbo.PharmacyFlyer_RoutePlanV2(RoutePlanId) ON DELETE CASCADE
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RoutePlanDropV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RoutePlanDropV2 (
    RoutePlanDropId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_RoutePlanDropV2 PRIMARY KEY,
    RoutePlanStopId BIGINT NOT NULL,
    CampaignId INT NOT NULL,
    DoctorId INT NULL,
    DoctorName NVARCHAR(200) NULL,
    MatchedSpecialityCode NVARCHAR(50) NULL,
    MatchedLevel VARCHAR(10) NULL,
    Status VARCHAR(20) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RoutePlanDropV2_Status DEFAULT 'pending',
    CompletedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_RoutePlanDropV2_Stop
      FOREIGN KEY (RoutePlanStopId) REFERENCES dbo.PharmacyFlyer_RoutePlanStopV2(RoutePlanStopId) ON DELETE CASCADE,
    CONSTRAINT FK_PharmacyFlyer_RoutePlanDropV2_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RoutePlanV2_AssignedUserId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RoutePlanV2')
)
  CREATE INDEX IX_PharmacyFlyer_RoutePlanV2_AssignedUserId
  ON dbo.PharmacyFlyer_RoutePlanV2 (AssignedUserId, PlanDate, Status);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RoutePlanStopV2_RoutePlanId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RoutePlanStopV2')
)
  CREATE INDEX IX_PharmacyFlyer_RoutePlanStopV2_RoutePlanId
  ON dbo.PharmacyFlyer_RoutePlanStopV2 (RoutePlanId, StopOrder);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RoutePlanDropV2_RoutePlanStopId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RoutePlanDropV2')
)
  CREATE INDEX IX_PharmacyFlyer_RoutePlanDropV2_RoutePlanStopId
  ON dbo.PharmacyFlyer_RoutePlanDropV2 (RoutePlanStopId);
GO
