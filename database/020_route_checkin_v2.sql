/*
  GPS-driven route planner (V2): rep check-in sessions + campaign->rep assignment.

  - PharmacyFlyer_CampaignAssignmentV2: admin assigns a campaign to a rep. The
    rep's geography is decided later by their mobile GPS check-in.
  - PharmacyFlyer_RouteCheckInV2: logs each mobile check-in/check-out session.
    This table only logs SESSIONS; coverage truth still comes from
    PharmacyFlyer_Delivery + PharmacyFlyer_RoutePlanDropV2 within FrequencyInDays.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_CampaignAssignmentV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_CampaignAssignmentV2 (
    CampaignAssignmentV2Id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_CampaignAssignmentV2 PRIMARY KEY,
    CampaignId INT NOT NULL,
    AssignedUserId INT NOT NULL,
    IsActive BIT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_CampaignAssignmentV2_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_CampaignAssignmentV2_CreatedDate DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_CampaignAssignmentV2_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'UX_PharmacyFlyer_CampaignAssignmentV2_Active'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignAssignmentV2')
)
  CREATE UNIQUE INDEX UX_PharmacyFlyer_CampaignAssignmentV2_Active
  ON dbo.PharmacyFlyer_CampaignAssignmentV2 (CampaignId, AssignedUserId)
  WHERE IsActive = 1;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RouteCheckInV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RouteCheckInV2 (
    RouteCheckInId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_RouteCheckInV2 PRIMARY KEY,
    UserId INT NOT NULL,
    CampaignId INT NULL,
    RoutePlanId BIGINT NULL,
    CheckInLat DECIMAL(10, 7) NULL,
    CheckInLng DECIMAL(10, 7) NULL,
    RadiusMiles DECIMAL(8, 2) NULL,
    StopCount INT NULL,
    CheckInAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RouteCheckInV2_CheckInAt DEFAULT SYSDATETIME(),
    CheckOutAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_RouteCheckInV2_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RouteCheckInV2_User'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RouteCheckInV2')
)
  CREATE INDEX IX_PharmacyFlyer_RouteCheckInV2_User
  ON dbo.PharmacyFlyer_RouteCheckInV2 (UserId, CheckInAt DESC);
GO
