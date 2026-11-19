/*
  One-time Florida database setup for the screens that are on:
    Login, Calendar, Deliveries, Smart Route.

*/
-- ============================================================================
-- BEGIN 001_schema.sql
-- ============================================================================
/*
  Pharmacy Flyer Tracker schema
  Existing tables expected:
    dbo.Master_User
    dbo.Master_Doctor

  New tables created:
    dbo.PharmacyFlyer_Campaign
    dbo.PharmacyFlyer_Delivery
    dbo.PharmacyFlyer_DeliveryPhoto
*/
IF OBJECT_ID('dbo.PharmacyFlyer_Campaign', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_Campaign (
      CampaignId       INT             IDENTITY (1, 1) PRIMARY KEY,
      CampaignName     NVARCHAR (200)  NOT NULL,
      Description      NVARCHAR (1000) NULL,
      StartDate        DATE            NULL,
      EndDate          DATE            NULL,
      IsActive         BIT             DEFAULT 1 NOT NULL,
      CreatedBy        INT             NULL, -- Master_User.ID
      CreatedDate      DATETIME2       DEFAULT SYSDATETIME() NOT NULL,
      LastModifiedBy   INT             NULL, -- Master_User.ID
      LastModifiedDate DATETIME2       NULL
    );
  END

IF OBJECT_ID('dbo.PharmacyFlyer_Delivery', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_Delivery (
      DeliveryId          BIGINT          IDENTITY (1, 1) PRIMARY KEY,
      CampaignId          INT             NOT NULL,
      DoctorId            INT             NULL, -- Master_Doctor.ID
      StaffUserId         INT             NOT NULL, -- Master_User.ID
      DoctorName          NVARCHAR (200)  NULL,
      ClinicName          NVARCHAR (200)  NULL,
      DoctorAddressStreet NVARCHAR (300)  NULL,
      DoctorAddressCity   NVARCHAR (100)  NULL,
      DoctorAddressState  NVARCHAR (50)   NULL,
      DoctorAddressZip    NVARCHAR (20)   NULL,
      PersonMet           NVARCHAR (50)   NULL,
      FlyerDelivered      BIT             DEFAULT 1 NOT NULL,
      ResponseStatus      NVARCHAR (50)   NULL,
      Latitude            DECIMAL (10, 7) NOT NULL,
      Longitude           DECIMAL (10, 7) NOT NULL,
      GpsAccuracyMeters   DECIMAL (10, 2) NULL,
      Notes               NVARCHAR (1000) NULL,
      FollowUpRequired    BIT             DEFAULT 0 NOT NULL,
      FollowUpDate        DATE            NULL,
      SubmittedAt         DATETIME2       DEFAULT SYSDATETIME() NOT NULL,
      CreatedDate         DATETIME2       DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT FK_PharmacyFlyer_Delivery_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign (CampaignId)
    );
  END

IF OBJECT_ID('dbo.PharmacyFlyer_DeliveryPhoto', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_DeliveryPhoto (
      PhotoId       BIGINT          IDENTITY (1, 1) PRIMARY KEY,
      DeliveryId    BIGINT          NOT NULL,
      FileName      NVARCHAR (255)  NULL,
      ContentType   NVARCHAR (100)  NULL,
      FileSizeBytes BIGINT          NULL,
      PhotoData     VARBINARY (MAX) NOT NULL,
      CreatedDate   DATETIME2       DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT FK_PharmacyFlyer_DeliveryPhoto_Delivery FOREIGN KEY (DeliveryId) REFERENCES dbo.PharmacyFlyer_Delivery (DeliveryId)
    );
  END


GO
CREATE INDEX IX_PharmacyFlyer_Delivery_Campaign_SubmittedAt
  ON dbo.PharmacyFlyer_Delivery(CampaignId, SubmittedAt DESC);


GO
CREATE INDEX IX_PharmacyFlyer_Delivery_Staff_SubmittedAt
  ON dbo.PharmacyFlyer_Delivery(StaffUserId, SubmittedAt DESC);


GO
-- END 001_schema.sql
-- ============================================================================
-- BEGIN active_campaign_and_delivery_columns.sql
-- ============================================================================
/*
  Columns the visible app reads or writes.
  Taken from 006_client_prompt_full_workflow.sql.
  The old target, assignment, and route tables in that file are not included.
*/
IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerTitle') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign
      ADD FlyerTitle NVARCHAR (200) NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerFileUrl') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign
      ADD FlyerFileUrl NVARCHAR (1000) NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'TargetAudience') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign
      ADD TargetAudience NVARCHAR (200) NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'DefaultVisitFrequencyDays') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign
      ADD DefaultVisitFrequencyDays INT NULL;
  END


GO
IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'AssignmentId') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery
      ADD AssignmentId BIGINT NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'RouteId') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery
      ADD RouteId BIGINT NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'TargetId') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery
      ADD TargetId BIGINT NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'ProofRequired') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery
      ADD ProofRequired BIT NULL;
  END

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'CompletionStatus') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery
      ADD CompletionStatus NVARCHAR (30) NULL;
  END


GO
-- END active_campaign_and_delivery_columns.sql
-- ============================================================================
-- BEGIN 007_user_profile_rbac.sql
-- ============================================================================
/*
  Role-based access control profiles for Pharmacy Flyer Tracker.

  Master_User has no usable role column (verified columns: ID, User_Id, names,
  password, email, phone, address fields, User_IsActive, audit columns).

  This script creates dbo.PharmacyFlyer_UserProfile linked to Master_User.ID.
  Does not alter dbo.Master_User.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_UserProfile', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_UserProfile (
      UserProfileId             INT             IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_UserProfile PRIMARY KEY,
      UserId                    INT             NOT NULL,
      Role                      VARCHAR (20)    NOT NULL,
      EmploymentType            VARCHAR (20)    NULL,
      HomeAddress               NVARCHAR (500)  NULL,
      HomeLatitude              DECIMAL (10, 7) NULL,
      HomeLongitude             DECIMAL (10, 7) NULL,
      DefaultDailyFlyerCapacity INT             CONSTRAINT DF_PharmacyFlyer_UserProfile_DefaultDailyFlyerCapacity DEFAULT 25 NOT NULL,
      IsActive                  BIT             CONSTRAINT DF_PharmacyFlyer_UserProfile_IsActive DEFAULT 1 NOT NULL,
      CreatedAt                 DATETIME2       CONSTRAINT DF_PharmacyFlyer_UserProfile_CreatedAt DEFAULT SYSDATETIME() NOT NULL,
      UpdatedAt                 DATETIME2       NULL,
      CONSTRAINT UQ_PharmacyFlyer_UserProfile_UserId UNIQUE (UserId),
      CONSTRAINT CK_PharmacyFlyer_UserProfile_Role CHECK (Role IN ('admin', 'manager', 'distributor')),
      CONSTRAINT CK_PharmacyFlyer_UserProfile_EmploymentType CHECK (EmploymentType IS NULL
                                                                    OR EmploymentType IN ('part_time', 'full_time'))
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_UserProfile_Role_IsActive'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_UserProfile'))
  BEGIN
    CREATE INDEX IX_PharmacyFlyer_UserProfile_Role_IsActive
      ON dbo.PharmacyFlyer_UserProfile(Role, IsActive);
  END


GO
-- END 007_user_profile_rbac.sql
-- ============================================================================
-- BEGIN 017_route_planner_campaign_specialty.sql
-- ============================================================================
/*
  Isolated route-planner campaign ↔ specialty rules (V2).
  Does not alter dbo.PharmacyFlyer_CampaignSpecialtyMapping used by legacy workflow.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_CampaignSpecialtyV2 (
      CampaignSpecialtyV2Id BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_CampaignSpecialtyV2 PRIMARY KEY,
      CampaignId            INT            NOT NULL,
      SpecialityRecID       INT            NULL,
      SpecialityCode        NVARCHAR (50)  NULL,
      Description           NVARCHAR (300) NULL,
      MatchLevel            VARCHAR (10)   CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_MatchLevel DEFAULT 'any' NOT NULL,
      MatchMode             VARCHAR (30)   CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_MatchMode DEFAULT 'primary_or_secondary' NOT NULL,
      IsActive              BIT            CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_IsActive DEFAULT 1 NOT NULL,
      CreatedDate           DATETIME2      CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyV2_CreatedDate DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT FK_PharmacyFlyer_CampaignSpecialtyV2_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign (CampaignId)
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_CampaignSpecialtyV2_CampaignId'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyV2'))
  BEGIN
    CREATE INDEX IX_PharmacyFlyer_CampaignSpecialtyV2_CampaignId
      ON dbo.PharmacyFlyer_CampaignSpecialtyV2(CampaignId, IsActive);
  END


GO
-- END 017_route_planner_campaign_specialty.sql
-- ============================================================================
-- BEGIN 018_route_plan_v2.sql
-- ============================================================================
/*
  Isolated route plan persistence (V2) for the new route-planner module.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_RoutePlanV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_RoutePlanV2 (
      RoutePlanId    BIGINT          IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RoutePlanV2 PRIMARY KEY,
      RouteName      NVARCHAR (200)  NOT NULL,
      CampaignId     INT             NULL,
      StartType      VARCHAR (20)    CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_StartType DEFAULT 'custom' NOT NULL,
      StartLabel     NVARCHAR (300)  NULL,
      StartLatitude  DECIMAL (10, 7) NULL,
      StartLongitude DECIMAL (10, 7) NULL,
      RadiusMiles    DECIMAL (8, 2)  NULL,
      Status         VARCHAR (20)    CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_Status DEFAULT 'draft' NOT NULL,
      AssignedUserId INT             NULL,
      PlanDate       DATE            CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_PlanDate DEFAULT (CAST (SYSDATETIME() AS DATE)) NOT NULL,
      CreatedBy      INT             NULL,
      CreatedDate    DATETIME2       CONSTRAINT DF_PharmacyFlyer_RoutePlanV2_CreatedDate DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT FK_PharmacyFlyer_RoutePlanV2_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign (CampaignId)
    );
  END


GO
IF OBJECT_ID('dbo.PharmacyFlyer_RoutePlanStopV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_RoutePlanStopV2 (
      RoutePlanStopId BIGINT          IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RoutePlanStopV2 PRIMARY KEY,
      RoutePlanId     BIGINT          NOT NULL,
      StopOrder       INT             NOT NULL,
      LocationKey     NVARCHAR (200)  NULL,
      PracticeId      INT             NULL,
      LocationId      INT             NULL,
      StopLabel       NVARCHAR (300)  NULL,
      AddressStreet   NVARCHAR (300)  NULL,
      AddressCity     NVARCHAR (100)  NULL,
      AddressState    NVARCHAR (50)   NULL,
      AddressZip      NVARCHAR (20)   NULL,
      Latitude        DECIMAL (10, 7) NULL,
      Longitude       DECIMAL (10, 7) NULL,
      DistanceMiles   DECIMAL (8, 2)  NULL,
      Status          VARCHAR (20)    CONSTRAINT DF_PharmacyFlyer_RoutePlanStopV2_Status DEFAULT 'pending' NOT NULL,
      CompletedAt     DATETIME2       NULL,
      CONSTRAINT FK_PharmacyFlyer_RoutePlanStopV2_Plan FOREIGN KEY (RoutePlanId) REFERENCES dbo.PharmacyFlyer_RoutePlanV2 (RoutePlanId) ON DELETE CASCADE
    );
  END


GO
IF OBJECT_ID('dbo.PharmacyFlyer_RoutePlanDropV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_RoutePlanDropV2 (
      RoutePlanDropId       BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RoutePlanDropV2 PRIMARY KEY,
      RoutePlanStopId       BIGINT         NOT NULL,
      CampaignId            INT            NOT NULL,
      DoctorId              INT            NULL,
      DoctorName            NVARCHAR (200) NULL,
      MatchedSpecialityCode NVARCHAR (50)  NULL,
      MatchedLevel          VARCHAR (10)   NULL,
      Status                VARCHAR (20)   CONSTRAINT DF_PharmacyFlyer_RoutePlanDropV2_Status DEFAULT 'pending' NOT NULL,
      CompletedAt           DATETIME2      NULL,
      CONSTRAINT FK_PharmacyFlyer_RoutePlanDropV2_Stop FOREIGN KEY (RoutePlanStopId) REFERENCES dbo.PharmacyFlyer_RoutePlanStopV2 (RoutePlanStopId) ON DELETE CASCADE,
      CONSTRAINT FK_PharmacyFlyer_RoutePlanDropV2_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign (CampaignId)
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_RoutePlanV2_AssignedUserId'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RoutePlanV2'))
  CREATE INDEX IX_PharmacyFlyer_RoutePlanV2_AssignedUserId
    ON dbo.PharmacyFlyer_RoutePlanV2(AssignedUserId, PlanDate, Status);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_RoutePlanStopV2_RoutePlanId'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RoutePlanStopV2'))
  CREATE INDEX IX_PharmacyFlyer_RoutePlanStopV2_RoutePlanId
    ON dbo.PharmacyFlyer_RoutePlanStopV2(RoutePlanId, StopOrder);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_RoutePlanDropV2_RoutePlanStopId'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RoutePlanDropV2'))
  CREATE INDEX IX_PharmacyFlyer_RoutePlanDropV2_RoutePlanStopId
    ON dbo.PharmacyFlyer_RoutePlanDropV2(RoutePlanStopId);


GO
-- END 018_route_plan_v2.sql
-- ============================================================================
-- BEGIN 019_campaign_frequency_in_days.sql
-- ============================================================================
/*
  Per-flyer distribution reset interval for route-planner campaigns.
  Doctors who received this flyer within FrequencyInDays are excluded from matching.
*/
IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FrequencyInDays') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign
      ADD FrequencyInDays INT NULL;
  END


GO
-- END 019_campaign_frequency_in_days.sql
-- ============================================================================
-- BEGIN 020_route_checkin_v2.sql
-- ============================================================================
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
      CampaignAssignmentV2Id BIGINT    IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_CampaignAssignmentV2 PRIMARY KEY,
      CampaignId             INT       NOT NULL,
      AssignedUserId         INT       NOT NULL,
      IsActive               BIT       CONSTRAINT DF_PharmacyFlyer_CampaignAssignmentV2_IsActive DEFAULT 1 NOT NULL,
      CreatedBy              INT       NULL,
      CreatedDate            DATETIME2 CONSTRAINT DF_PharmacyFlyer_CampaignAssignmentV2_CreatedDate DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT FK_PharmacyFlyer_CampaignAssignmentV2_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign (CampaignId)
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'UX_PharmacyFlyer_CampaignAssignmentV2_Active'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignAssignmentV2'))
  CREATE UNIQUE INDEX UX_PharmacyFlyer_CampaignAssignmentV2_Active
    ON dbo.PharmacyFlyer_CampaignAssignmentV2(CampaignId, AssignedUserId) WHERE IsActive = 1;


GO
IF OBJECT_ID('dbo.PharmacyFlyer_RouteCheckInV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_RouteCheckInV2 (
      RouteCheckInId BIGINT          IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RouteCheckInV2 PRIMARY KEY,
      UserId         INT             NOT NULL,
      CampaignId     INT             NULL,
      RoutePlanId    BIGINT          NULL,
      CheckInLat     DECIMAL (10, 7) NULL,
      CheckInLng     DECIMAL (10, 7) NULL,
      RadiusMiles    DECIMAL (8, 2)  NULL,
      StopCount      INT             NULL,
      CheckInAt      DATETIME2       CONSTRAINT DF_PharmacyFlyer_RouteCheckInV2_CheckInAt DEFAULT SYSDATETIME() NOT NULL,
      CheckOutAt     DATETIME2       NULL,
      CONSTRAINT FK_PharmacyFlyer_RouteCheckInV2_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign (CampaignId)
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_RouteCheckInV2_User'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RouteCheckInV2'))
  CREATE INDEX IX_PharmacyFlyer_RouteCheckInV2_User
    ON dbo.PharmacyFlyer_RouteCheckInV2(UserId, CheckInAt DESC);


GO
-- END 020_route_checkin_v2.sql
-- ============================================================================
-- BEGIN 021_location_visit_frequency_v2.sql
-- ============================================================================
/*
  Location-based visit frequency (V2).

  Visit Frequency is the number of days between sales-rep visits to a physical
  location. It is a scheduling helper: Next Visit Date = Last Visit Date +
  VisitFrequencyDays, where Last Visit Date is computed from the most recent
  completed flyer drop / delivery at that location.

  This REPLACES the old per-campaign PharmacyFlyer_Campaign.FrequencyInDays
  concept. Frequency is now keyed by the route planner's stable LocationKey
  (e.g. "geo:27.7712,-82.6586", "loc:123", "addr:...|33713").
*/
IF OBJECT_ID('dbo.PharmacyFlyer_LocationVisitV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_LocationVisitV2 (
      LocationVisitV2Id  BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_LocationVisitV2 PRIMARY KEY,
      LocationKey        NVARCHAR (200) NOT NULL,
      VisitFrequencyDays INT            CONSTRAINT DF_PharmacyFlyer_LocationVisitV2_Freq DEFAULT 30 NOT NULL,
      CreatedDate        DATETIME2      CONSTRAINT DF_PharmacyFlyer_LocationVisitV2_Created DEFAULT SYSDATETIME() NOT NULL,
      LastModifiedDate   DATETIME2      NULL
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'UX_PharmacyFlyer_LocationVisitV2_LocationKey'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationVisitV2'))
  CREATE UNIQUE INDEX UX_PharmacyFlyer_LocationVisitV2_LocationKey
    ON dbo.PharmacyFlyer_LocationVisitV2(LocationKey);


GO
-- END 021_location_visit_frequency_v2.sql
-- ============================================================================
-- BEGIN 024_location_hold_v2.sql
-- ============================================================================
/*
  Automated location holds for multi-rep route planner (V2).

  While a rep is checked in, pending stops on their route hold the locationKey
  so other reps skip it at check-in. Holds release on check-out, stop completion,
  or stale-session cleanup.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_LocationHoldV2 (
      LocationHoldId  BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_LocationHoldV2 PRIMARY KEY,
      LocationKey     NVARCHAR (200) NOT NULL,
      PlanDate        DATE           NOT NULL,
      HeldByUserId    INT            NOT NULL,
      RouteCheckInId  BIGINT         NULL,
      RoutePlanId     BIGINT         NULL,
      RoutePlanStopId BIGINT         NULL,
      HeldAt          DATETIME2      CONSTRAINT DF_PharmacyFlyer_LocationHoldV2_HeldAt DEFAULT SYSDATETIME() NOT NULL,
      ReleasedAt      DATETIME2      NULL
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'UX_PharmacyFlyer_LocationHoldV2_Active'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2'))
  CREATE UNIQUE INDEX UX_PharmacyFlyer_LocationHoldV2_Active
    ON dbo.PharmacyFlyer_LocationHoldV2(LocationKey, PlanDate) WHERE ReleasedAt IS NULL;


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_LocationHoldV2_CheckIn'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2'))
  CREATE INDEX IX_PharmacyFlyer_LocationHoldV2_CheckIn
    ON dbo.PharmacyFlyer_LocationHoldV2(RouteCheckInId, ReleasedAt) WHERE RouteCheckInId IS NOT NULL;


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_LocationHoldV2_UserDate'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2'))
  CREATE INDEX IX_PharmacyFlyer_LocationHoldV2_UserDate
    ON dbo.PharmacyFlyer_LocationHoldV2(HeldByUserId, PlanDate, ReleasedAt);


GO
-- END 024_location_hold_v2.sql
-- ============================================================================
-- BEGIN 025_app_new_entries.sql
-- ============================================================================
/*
  Mobile "Add New" entries from field reps.
  Admin reviews at /new-entries.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_APPNewEntries (
      AppNewEntryId     BIGINT          IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_APPNewEntries PRIMARY KEY,
      SubmittedByUserId INT             NOT NULL,
      PracticeName      NVARCHAR (200)  NOT NULL,
      LocationAddress   NVARCHAR (500)  NOT NULL,
      ProviderName      NVARCHAR (200)  NOT NULL,
      ProviderAddress   NVARCHAR (500)  NOT NULL,
      NpiNumber         VARCHAR (20)    NULL,
      Phone             VARCHAR (30)    NULL,
      TaxonomyDesc      NVARCHAR (255)  NULL,
      Latitude          DECIMAL (10, 7) NULL,
      Longitude         DECIMAL (10, 7) NULL,
      Status            NVARCHAR (30)   CONSTRAINT DF_PharmacyFlyer_APPNewEntries_Status DEFAULT 'pending' NOT NULL,
      SubmittedAt       DATETIME2       CONSTRAINT DF_PharmacyFlyer_APPNewEntries_SubmittedAt DEFAULT SYSDATETIME() NOT NULL
    );
  END


GO
IF OBJECT_ID('dbo.PharmacyFlyer_APPNewEntryPhoto', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_APPNewEntryPhoto (
      PhotoId       BIGINT          IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_APPNewEntryPhoto PRIMARY KEY,
      AppNewEntryId BIGINT          NOT NULL,
      FileName      NVARCHAR (255)  NULL,
      ContentType   NVARCHAR (100)  NULL,
      FileSizeBytes BIGINT          NULL,
      PhotoData     VARBINARY (MAX) NOT NULL,
      CreatedDate   DATETIME2       CONSTRAINT DF_PharmacyFlyer_APPNewEntryPhoto_CreatedDate DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT FK_PharmacyFlyer_APPNewEntryPhoto_Entry FOREIGN KEY (AppNewEntryId) REFERENCES dbo.PharmacyFlyer_APPNewEntries (AppNewEntryId)
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPNewEntries_User'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries'))
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_User
    ON dbo.PharmacyFlyer_APPNewEntries(SubmittedByUserId, SubmittedAt DESC);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPNewEntries_SubmittedAt'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries'))
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_SubmittedAt
    ON dbo.PharmacyFlyer_APPNewEntries(SubmittedAt DESC);


GO
-- END 025_app_new_entries.sql
-- ============================================================================
-- BEGIN 026_app_new_entries_flyer.sql
-- ============================================================================
/*
  Flyer drop fields for Add New entries.
*/
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'TaxonomyCode') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD TaxonomyCode VARCHAR (20) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'PrimaryTaxonomy') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD PrimaryTaxonomy NVARCHAR (10) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'SelectedTaxonomy') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD SelectedTaxonomy NVARCHAR (255) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'TaxonomyState') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD TaxonomyState VARCHAR (10) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'LicenseNumber') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD LicenseNumber NVARCHAR (50) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'CampaignId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD CampaignId INT NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'FlyerTitle') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD FlyerTitle NVARCHAR (200) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'FlyerDropped') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD FlyerDropped BIT CONSTRAINT DF_PharmacyFlyer_APPNewEntries_FlyerDropped DEFAULT 0 NOT NULL;


GO
-- END 026_app_new_entries_flyer.sql
-- ============================================================================
-- BEGIN 027_app_new_entries_visit.sql
-- ============================================================================
/*
  Org visit grouping for Add New entries (one flyer per org + provider discovery rows).
*/
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'VisitBatchId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD VisitBatchId UNIQUEIDENTIFIER NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'OrganizationNpi') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD OrganizationNpi VARCHAR (20) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'IsOrgFlyerRow') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD IsOrgFlyerRow BIT CONSTRAINT DF_PharmacyFlyer_APPNewEntries_IsOrgFlyerRow DEFAULT 0 NOT NULL;


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPNewEntries_VisitBatch'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries'))
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_VisitBatch
    ON dbo.PharmacyFlyer_APPNewEntries(VisitBatchId, SubmittedAt DESC);


GO
-- END 027_app_new_entries_visit.sql
-- ============================================================================
-- BEGIN 028_app_physical_stops.sql
-- ============================================================================
/*
  Physical stop / flyer drop parent record for Add New entries.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_APPPhysicalStops', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_APPPhysicalStops (
      PhysicalStopId    UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL CONSTRAINT PK_PharmacyFlyer_APPPhysicalStops PRIMARY KEY,
      VisitBatchId      UNIQUEIDENTIFIER NOT NULL,
      SubmittedByUserId INT              NOT NULL,
      PracticeName      NVARCHAR (200)   NOT NULL,
      LocationAddress   NVARCHAR (500)   NOT NULL,
      Street            NVARCHAR (200)   NULL,
      Suite             NVARCHAR (100)   NULL,
      City              NVARCHAR (100)   NULL,
      State             VARCHAR (10)     NULL,
      PostalCode        VARCHAR (20)     NULL,
      Latitude          DECIMAL (10, 7)  NULL,
      Longitude         DECIMAL (10, 7)  NULL,
      DropStatus        NVARCHAR (50)    NOT NULL,
      StopType          NVARCHAR (50)    NULL,
      CampaignId        INT              NULL,
      FlyerTitle        NVARCHAR (200)   NULL,
      FlyerQuantity     INT              CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_FlyerQuantity DEFAULT 1 NOT NULL,
      Notes             NVARCHAR (1000)  NULL,
      Status            NVARCHAR (30)    CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_Status DEFAULT 'pending' NOT NULL,
      CreatedAt         DATETIME2        CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_CreatedAt DEFAULT SYSDATETIME() NOT NULL,
      UpdatedAt         DATETIME2        CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_UpdatedAt DEFAULT SYSDATETIME() NOT NULL
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPPhysicalStops_VisitBatch'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPPhysicalStops'))
  CREATE INDEX IX_PharmacyFlyer_APPPhysicalStops_VisitBatch
    ON dbo.PharmacyFlyer_APPPhysicalStops(VisitBatchId, CreatedAt DESC);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPPhysicalStops_User'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPPhysicalStops'))
  CREATE INDEX IX_PharmacyFlyer_APPPhysicalStops_User
    ON dbo.PharmacyFlyer_APPPhysicalStops(SubmittedByUserId, CreatedAt DESC);


GO
-- END 028_app_physical_stops.sql
-- ============================================================================
-- BEGIN 029_app_visit_org_links.sql
-- ============================================================================
/*
  NPI-2 organization links to a physical stop (enrichment, not flyer count).
*/
IF OBJECT_ID('dbo.PharmacyFlyer_APPVisitOrgLinks', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_APPVisitOrgLinks (
      Id                  BIGINT           IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_APPVisitOrgLinks PRIMARY KEY,
      PhysicalStopId      UNIQUEIDENTIFIER NOT NULL,
      VisitBatchId        UNIQUEIDENTIFIER NOT NULL,
      OrganizationNpi     VARCHAR (20)     NOT NULL,
      OrganizationName    NVARCHAR (200)   NOT NULL,
      OrganizationAddress NVARCHAR (500)   NULL,
      TaxonomyCode        VARCHAR (20)     NULL,
      TaxonomyDescription NVARCHAR (255)   NULL,
      DistanceMiles       DECIMAL (8, 2)   NULL,
      SuiteLabel          NVARCHAR (100)   NULL,
      VerificationStatus  NVARCHAR (50)    CONSTRAINT DF_PharmacyFlyer_APPVisitOrgLinks_VerificationStatus DEFAULT 'npi_only' NOT NULL,
      FlyerAttributed     BIT              CONSTRAINT DF_PharmacyFlyer_APPVisitOrgLinks_FlyerAttributed DEFAULT 0 NOT NULL,
      CreatedAt           DATETIME2        CONSTRAINT DF_PharmacyFlyer_APPVisitOrgLinks_CreatedAt DEFAULT SYSDATETIME() NOT NULL
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPVisitOrgLinks_PhysicalStop'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPVisitOrgLinks'))
  CREATE INDEX IX_PharmacyFlyer_APPVisitOrgLinks_PhysicalStop
    ON dbo.PharmacyFlyer_APPVisitOrgLinks(PhysicalStopId, CreatedAt DESC);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPVisitOrgLinks_VisitBatch'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPVisitOrgLinks'))
  CREATE INDEX IX_PharmacyFlyer_APPVisitOrgLinks_VisitBatch
    ON dbo.PharmacyFlyer_APPVisitOrgLinks(VisitBatchId, CreatedAt DESC);


GO
-- END 029_app_visit_org_links.sql
-- ============================================================================
-- BEGIN 030_app_physical_stop_extensions.sql
-- ============================================================================
/*
  Link provider candidate rows and photos to physical stops.
*/
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'PhysicalStopId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD PhysicalStopId UNIQUEIDENTIFIER NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntries', 'VerificationStatus') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntries
    ADD VerificationStatus NVARCHAR (50) NULL;


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPNewEntries_PhysicalStop'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries'))
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_PhysicalStop
    ON dbo.PharmacyFlyer_APPNewEntries(PhysicalStopId, SubmittedAt DESC);


GO
IF COL_LENGTH('dbo.PharmacyFlyer_APPNewEntryPhoto', 'PhysicalStopId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntryPhoto
    ADD PhysicalStopId UNIQUEIDENTIFIER NULL;


GO
IF EXISTS (SELECT 1
           FROM   sys.columns
           WHERE  object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntryPhoto')
                  AND name = 'AppNewEntryId'
                  AND is_nullable = 0)
  ALTER TABLE dbo.PharmacyFlyer_APPNewEntryPhoto ALTER COLUMN AppNewEntryId BIGINT NULL;


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_APPNewEntryPhoto_PhysicalStop'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntryPhoto'))
  CREATE INDEX IX_PharmacyFlyer_APPNewEntryPhoto_PhysicalStop
    ON dbo.PharmacyFlyer_APPNewEntryPhoto(PhysicalStopId, CreatedDate DESC);


GO
-- END 030_app_physical_stop_extensions.sql
-- ============================================================================
-- BEGIN 031_nucc_specialty_map.sql
-- ============================================================================
/*
  Bridge NUCC taxonomy codes/descriptions (NPI registry) to internal prescriber
  specialties (Master_PrsSpecialitiesList.RecID). Used by new-entry flyer recommendations.
  Do NOT map internal RR — * routing codes here; those are not NUCC taxonomies.

  Note: Master_PrsSpecialitiesList.RecID is not a declared PK in this database, so we
  store SpecialityRecID without a FK (same pattern as PharmacyFlyer_CampaignSpecialtyV2).
*/
IF OBJECT_ID('dbo.PharmacyFlyer_NuccSpecialtyMap', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_NuccSpecialtyMap (
      NuccSpecialtyMapId  BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_NuccSpecialtyMap PRIMARY KEY,
      TaxonomyCode        VARCHAR (20)   NULL,
      TaxonomyDescPattern NVARCHAR (300) NULL,
      SpecialityRecID     INT            NOT NULL,
      Priority            INT            CONSTRAINT DF_PharmacyFlyer_NuccSpecialtyMap_Priority DEFAULT 100 NOT NULL,
      IsActive            BIT            CONSTRAINT DF_PharmacyFlyer_NuccSpecialtyMap_IsActive DEFAULT 1 NOT NULL,
      Notes               NVARCHAR (500) NULL,
      CreatedDate         DATETIME2      CONSTRAINT DF_PharmacyFlyer_NuccSpecialtyMap_CreatedDate DEFAULT SYSDATETIME() NOT NULL,
      CONSTRAINT CK_PharmacyFlyer_NuccSpecialtyMap_HasKey CHECK (TaxonomyCode IS NOT NULL
                                                                 OR TaxonomyDescPattern IS NOT NULL)
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NuccSpecialtyMap_TaxonomyCode'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NuccSpecialtyMap'))
  BEGIN
    CREATE INDEX IX_PharmacyFlyer_NuccSpecialtyMap_TaxonomyCode
      ON dbo.PharmacyFlyer_NuccSpecialtyMap(TaxonomyCode, IsActive)
      INCLUDE(SpecialityRecID, Priority, TaxonomyDescPattern);
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NuccSpecialtyMap_SpecialityRecID'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NuccSpecialtyMap'))
  BEGIN
    CREATE INDEX IX_PharmacyFlyer_NuccSpecialtyMap_SpecialityRecID
      ON dbo.PharmacyFlyer_NuccSpecialtyMap(SpecialityRecID, IsActive)
      INCLUDE(TaxonomyCode, TaxonomyDescPattern, Priority);
  END


GO
/*
  Example seed rows (adjust SpecialityRecID to match your Master_PrsSpecialitiesList).
  Uncomment and edit RecIDs after verifying in your environment.

INSERT INTO dbo.PharmacyFlyer_NuccSpecialtyMap (TaxonomyCode, TaxonomyDescPattern, SpecialityRecID, Priority, Notes)
SELECT v.TaxonomyCode, v.TaxonomyDescPattern, sl.RecID, v.Priority, v.Notes
FROM (VALUES
  ('207Q00000X', NULL, 100, 'Family Medicine NUCC'),
  ('207R00000X', NULL, 100, 'Internal Medicine NUCC'),
  ('207RC0000X', NULL, 100, 'Cardiovascular Disease NUCC'),
  ('207RE0101X', NULL, 100, 'Endocrinology/Diabetes NUCC'),
  (NULL, '%FAMILY MEDICINE%', 100, 'Family Medicine desc'),
  (NULL, '%INTERNAL MEDICINE%', 100, 'Internal Medicine desc'),
  (NULL, '%CARDIOLOGY%', 100, 'Cardiology desc'),
  (NULL, '%ENDOCRIN%', 100, 'Endocrinology desc')
) AS v(TaxonomyCode, TaxonomyDescPattern, Priority, Notes)
INNER JOIN dbo.Master_PrsSpecialitiesList sl
  ON UPPER(LTRIM(RTRIM(sl.SpecialityCode))) = 'PHC'
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PharmacyFlyer_NuccSpecialtyMap m
  WHERE ISNULL(m.TaxonomyCode, '') = ISNULL(v.TaxonomyCode, '')
    AND ISNULL(m.TaxonomyDescPattern, '') = ISNULL(v.TaxonomyDescPattern, '')
);
*/
-- END 031_nucc_specialty_map.sql
-- ============================================================================
-- BEGIN 032_npi_registry_data.sql
-- ============================================================================
/*
  NPPES registry snapshot for St Petersburg / Pinellas Park, FL.
  Parent row holds core provider + parsed mailing/primary address columns.
  Secondary addresses and taxonomies are one-to-many child tables.
*/
IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy', 'U') IS NOT NULL
  DROP TABLE dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy;


GO
IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress', 'U') IS NOT NULL
  DROP TABLE dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress;


GO
IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_NPI_Registry_Data (
      RegistryProviderId BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_NPI_Registry_Data PRIMARY KEY,
      Npi                VARCHAR (10)   NOT NULL,
      ProviderName       NVARCHAR (300) NOT NULL,
      EnumerationDate    DATE           NULL,
      NpiType            VARCHAR (30)   NOT NULL,
      Status             NVARCHAR (20)  NOT NULL,
      AuthOfficialName   NVARCHAR (200) NULL,
      AuthOfficialTitle  NVARCHAR (100) NULL,
      AuthOfficialPhone  VARCHAR (30)   NULL,
      MailingStreetLine1 NVARCHAR (200) NULL,
      MailingCity        NVARCHAR (100) NULL,
      MailingState       VARCHAR (10)   NULL,
      MailingPostalCode  VARCHAR (20)   NULL,
      MailingCountry     NVARCHAR (50)  NULL,
      MailingPhone       VARCHAR (30)   NULL,
      MailingFax         VARCHAR (30)   NULL,
      PrimaryStreetLine1 NVARCHAR (200) NULL,
      PrimaryCity        NVARCHAR (100) NULL,
      PrimaryState       VARCHAR (10)   NULL,
      PrimaryPostalCode  VARCHAR (20)   NULL,
      PrimaryCountry     NVARCHAR (50)  NULL,
      PrimaryPhone       VARCHAR (30)   NULL,
      PrimaryFax         VARCHAR (30)   NULL,
      SourceRegion       VARCHAR (50)   CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_SourceRegion DEFAULT 'stpt_pinellas' NOT NULL,
      ImportedAt         DATETIME2      CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_ImportedAt DEFAULT SYSDATETIME() NOT NULL
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'UX_PharmacyFlyer_NPI_Registry_Data_Npi'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data'))
  CREATE UNIQUE INDEX UX_PharmacyFlyer_NPI_Registry_Data_Npi
    ON dbo.PharmacyFlyer_NPI_Registry_Data(Npi);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NPI_Registry_Data_PrimaryCity'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data'))
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_PrimaryCity
    ON dbo.PharmacyFlyer_NPI_Registry_Data(PrimaryCity, PrimaryState)
    INCLUDE(ProviderName, NpiType, Status);


GO
IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress (
      SecondaryAddressId BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress PRIMARY KEY,
      RegistryProviderId BIGINT         NOT NULL,
      SortOrder          INT            CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_SortOrder DEFAULT 1 NOT NULL,
      StreetLine1        NVARCHAR (200) NULL,
      City               NVARCHAR (100) NULL,
      State              VARCHAR (10)   NULL,
      PostalCode         VARCHAR (20)   NULL,
      Country            NVARCHAR (50)  NULL,
      Phone              VARCHAR (30)   NULL,
      Fax                VARCHAR (30)   NULL,
      CONSTRAINT FK_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_Provider FOREIGN KEY (RegistryProviderId) REFERENCES dbo.PharmacyFlyer_NPI_Registry_Data (RegistryProviderId) ON DELETE CASCADE
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_Provider'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress'))
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_Provider
    ON dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress(RegistryProviderId, SortOrder);


GO
IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy (
      TaxonomyId          BIGINT         IDENTITY (1, 1) NOT NULL CONSTRAINT PK_PharmacyFlyer_NPI_Registry_Data_Taxonomy PRIMARY KEY,
      RegistryProviderId  BIGINT         NOT NULL,
      SortOrder           INT            CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_Taxonomy_SortOrder DEFAULT 1 NOT NULL,
      IsPrimary           BIT            CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_Taxonomy_IsPrimary DEFAULT 0 NOT NULL,
      TaxonomyCode        VARCHAR (20)   NULL,
      TaxonomyDescription NVARCHAR (300) NULL,
      TaxonomyState       VARCHAR (10)   NULL,
      LicenseNumber       VARCHAR (50)   NULL,
      CONSTRAINT FK_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Provider FOREIGN KEY (RegistryProviderId) REFERENCES dbo.PharmacyFlyer_NPI_Registry_Data (RegistryProviderId) ON DELETE CASCADE
    );
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Provider'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy'))
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Provider
    ON dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy(RegistryProviderId, SortOrder);


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Code'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy'))
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Code
    ON dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy(TaxonomyCode, IsPrimary)
    INCLUDE(TaxonomyDescription, TaxonomyState, LicenseNumber);


GO
-- END 032_npi_registry_data.sql
-- ============================================================================
-- BEGIN 033_npi_registry_geocode.sql
-- ============================================================================
/*
  Geocoded coordinates for NPI registry primary practice addresses.
  Populated by backend-api/scripts/geocode-npi-registry.ts (uses shared Nominatim cache).
*/
IF COL_LENGTH('dbo.PharmacyFlyer_NPI_Registry_Data', 'PrimaryLatitude') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_NPI_Registry_Data
      ADD PrimaryLatitude  DECIMAL (10, 7) NULL,
          PrimaryLongitude DECIMAL (10, 7) NULL,
          GeocodedAt       DATETIME2       NULL;
  END


GO
IF NOT EXISTS (SELECT 1
               FROM   sys.indexes
               WHERE  name = 'IX_PharmacyFlyer_NPI_Registry_Data_Geocode'
                      AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data'))
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_Geocode
    ON dbo.PharmacyFlyer_NPI_Registry_Data(PrimaryLatitude, PrimaryLongitude)
    INCLUDE(PrimaryStreetLine1, PrimaryCity, PrimaryState, PrimaryPostalCode, Status);


GO
-- END 033_npi_registry_geocode.sql
-- ============================================================================
-- BEGIN 034_route_plan_stop_practice_name.sql
-- ============================================================================
-- Practice name typed by the distributor at a route stop.
-- Kept separate from StopLabel, which can be a doctor/provider name for unmapped stops.
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'PracticeNameEntered') IS NULL
  BEGIN
    ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
      ADD PracticeNameEntered NVARCHAR (300) NULL;
  END


GO
-- END 034_route_plan_stop_practice_name.sql
-- ============================================================================
-- BEGIN 035_route_plan_stop_front_desk.sql
-- ============================================================================
-- Front-desk notes collected by the distributor at each route stop.
-- Idempotent. The backend also adds these columns lazily on first use
-- (routeThreeEnrichment.ts -> ensureFrontDeskColumns).
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskOutcome') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
    ADD FrontDeskOutcome NVARCHAR (40) NULL; -- accepted | left_at_desk | refused | closed | wrong_address


GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'BestTimeToVisit') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
    ADD BestTimeToVisit NVARCHAR (40) NULL; -- morning | midday | afternoon


GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskContactName') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
    ADD FrontDeskContactName NVARCHAR (200) NULL; -- who to ask for next time


GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskNote') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
    ADD FrontDeskNote NVARCHAR (1000) NULL;


GO
IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskUpdatedAt') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2
    ADD FrontDeskUpdatedAt DATETIME2 NULL;


-- END 035_route_plan_stop_front_desk.sql