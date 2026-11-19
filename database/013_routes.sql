/*
  Distributor delivery routes: home/start location to approved campaign target stops.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_Route (
    RouteId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_Route PRIMARY KEY,
    RouteName NVARCHAR(200) NOT NULL,
    RouteDate DATE NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_RouteDate DEFAULT (CAST(SYSDATETIME() AS DATE)),
    DistributorUserId INT NULL,
    MarketId INT NULL,
    StartType VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_StartType DEFAULT 'home',
    StartAddress NVARCHAR(500) NULL,
    StartLatitude DECIMAL(10, 7) NULL,
    StartLongitude DECIMAL(10, 7) NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_Status DEFAULT 'draft',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_Route_Market FOREIGN KEY (MarketId) REFERENCES dbo.PharmacyFlyer_Market(MarketId),
    CONSTRAINT CK_PharmacyFlyer_Route_StartType CHECK (StartType IN ('home', 'current', 'custom')),
    CONSTRAINT CK_PharmacyFlyer_Route_Status CHECK (Status IN ('draft', 'assigned', 'in_progress', 'completed', 'cancelled'))
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RouteStop (
    RouteStopId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RouteStop PRIMARY KEY,
    RouteId INT NOT NULL,
    StopOrder INT NOT NULL,
    CampaignTargetId INT NULL,
    CampaignId INT NULL,
    CampaignConfigId INT NULL,
    TargetType VARCHAR(20) NOT NULL,
    DoctorId INT NULL,
    NPI VARCHAR(10) NULL,
    PharmacyId INT NULL,
    AssignedFlyerName NVARCHAR(200) NULL,
    StopLabel NVARCHAR(200) NULL,
    StopAddress NVARCHAR(500) NULL,
    StopLatitude DECIMAL(10, 7) NULL,
    StopLongitude DECIMAL(10, 7) NULL,
    ScheduledTime TIME NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_Status DEFAULT 'pending',
    CheckInRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_CheckInRequired DEFAULT 1,
    ProofUploadRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_ProofUploadRequired DEFAULT 1,
    CompletedAt DATETIME2 NULL,
    SkippedReason NVARCHAR(500) NULL,
    Notes NVARCHAR(1000) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_RouteStop_Route FOREIGN KEY (RouteId) REFERENCES dbo.PharmacyFlyer_Route(RouteId) ON DELETE CASCADE,
    CONSTRAINT FK_PharmacyFlyer_RouteStop_Target FOREIGN KEY (CampaignTargetId) REFERENCES dbo.PharmacyFlyer_CampaignTarget(CampaignTargetId),
    CONSTRAINT FK_PharmacyFlyer_RouteStop_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
    CONSTRAINT CK_PharmacyFlyer_RouteStop_TargetType CHECK (TargetType IN ('doctor', 'pharmacy')),
    CONSTRAINT CK_PharmacyFlyer_RouteStop_Status CHECK (Status IN ('pending', 'arrived', 'completed', 'skipped', 'failed'))
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_Route_DistributorUserId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Route')
)
  CREATE INDEX IX_PharmacyFlyer_Route_DistributorUserId
  ON dbo.PharmacyFlyer_Route (DistributorUserId, RouteDate, Status);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_Route_RouteDate'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Route')
)
  CREATE INDEX IX_PharmacyFlyer_Route_RouteDate
  ON dbo.PharmacyFlyer_Route (RouteDate, Status);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RouteStop_RouteId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RouteStop')
)
  CREATE INDEX IX_PharmacyFlyer_RouteStop_RouteId
  ON dbo.PharmacyFlyer_RouteStop (RouteId, StopOrder);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RouteStop_CampaignTargetId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RouteStop')
)
  CREATE INDEX IX_PharmacyFlyer_RouteStop_CampaignTargetId
  ON dbo.PharmacyFlyer_RouteStop (CampaignTargetId);
GO
