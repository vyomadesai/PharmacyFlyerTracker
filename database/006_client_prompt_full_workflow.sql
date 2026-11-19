/*
  Client prompt full workflow implementation.

  Covers:
  1. Doctor/NPI database configuration
  2. Pharmacy/doctor target locations
  3. Flyer/campaign metadata
  4. Geo/radius/market targeting rules
  5. Admin approval before assignment
  6. Field-person assignment list
  7. Route generation and route stops
  8. Visit frequency / next due date tracking
  9. GPS check-in
  10. Proof photo upload linkage
  11. Calendar/scheduled daily work
  12. Reporting/status visibility
*/

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerTitle') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD FlyerTitle NVARCHAR(200) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerFileUrl') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD FlyerFileUrl NVARCHAR(1000) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'TargetAudience') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD TargetAudience NVARCHAR(200) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'DefaultVisitFrequencyDays') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD DefaultVisitFrequencyDays INT NULL;
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_LocationTarget', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_LocationTarget (
        TargetId BIGINT IDENTITY(1,1) PRIMARY KEY,
        TargetType NVARCHAR(30) NOT NULL, -- Doctor, Pharmacy, Other
        DoctorId INT NULL,
        NpiNumber NVARCHAR(50) NULL,
        TargetName NVARCHAR(250) NOT NULL,
        PracticeName NVARCHAR(250) NULL,
        Specialty NVARCHAR(250) NULL,
        DoctorCategory NVARCHAR(80) NULL, -- Primary care, Specialist, Custom
        PrimaryAddressStreet NVARCHAR(300) NULL,
        PrimaryAddressCity NVARCHAR(100) NULL,
        PrimaryAddressState NVARCHAR(50) NULL,
        PrimaryAddressZip NVARCHAR(20) NULL,
        SecondaryAddressStreet NVARCHAR(300) NULL,
        SecondaryAddressCity NVARCHAR(100) NULL,
        SecondaryAddressState NVARCHAR(50) NULL,
        SecondaryAddressZip NVARCHAR(20) NULL,
        Phone NVARCHAR(50) NULL,
        Fax NVARCHAR(50) NULL,
        LicenseNumber NVARCHAR(80) NULL,
        TaxonomyCode NVARCHAR(80) NULL,
        IsPrimaryTaxonomy BIT NULL,
        TaxonomyDescription NVARCHAR(500) NULL,
        MarketNumber NVARCHAR(80) NULL,
        GeographyLabel NVARCHAR(200) NULL,
        Latitude DECIMAL(10,7) NULL,
        Longitude DECIMAL(10,7) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_LocationTarget_IsActive DEFAULT 1,
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_LocationTarget_CreatedDate DEFAULT SYSDATETIME(),
        LastModifiedBy INT NULL,
        LastModifiedDate DATETIME2 NULL
    );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_TargetingRule (
        ConfigId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CampaignId INT NOT NULL,
        ConfigName NVARCHAR(200) NOT NULL,
        TargetType NVARCHAR(30) NOT NULL, -- Doctor, Pharmacy, Both
        PharmacyNumber NVARCHAR(80) NULL,
        Specialty NVARCHAR(250) NULL,
        CustomSpecialty NVARCHAR(250) NULL,
        DoctorCategory NVARCHAR(80) NULL,
        NpiNumber NVARCHAR(50) NULL,
        TargetCity NVARCHAR(100) NULL,
        TargetState NVARCHAR(50) NULL,
        MarketNumber NVARCHAR(80) NULL,
        CenterLatitude DECIMAL(10,7) NULL,
        CenterLongitude DECIMAL(10,7) NULL,
        RadiusMiles DECIMAL(8,2) NULL,
        VisitFrequencyDays INT NULL,
        CheckInRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_CheckInRequired DEFAULT 1,
        ProofRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_ProofRequired DEFAULT 1,
        IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_IsActive DEFAULT 1,
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_CreatedDate DEFAULT SYSDATETIME(),
        LastModifiedBy INT NULL,
        LastModifiedDate DATETIME2 NULL,
        CONSTRAINT FK_PharmacyFlyer_TargetingRule_Campaign
            FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
    );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_Assignment', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_Assignment (
        AssignmentId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CampaignId INT NOT NULL,
        ConfigId BIGINT NULL,
        TargetId BIGINT NULL,
        DoctorId INT NULL,
        StaffUserId INT NULL,
        TargetType NVARCHAR(30) NOT NULL,
        TargetName NVARCHAR(250) NOT NULL,
        PracticeName NVARCHAR(250) NULL,
        Specialty NVARCHAR(250) NULL,
        NpiNumber NVARCHAR(50) NULL,
        AddressStreet NVARCHAR(300) NULL,
        AddressCity NVARCHAR(100) NULL,
        AddressState NVARCHAR(50) NULL,
        AddressZip NVARCHAR(20) NULL,
        Phone NVARCHAR(50) NULL,
        Latitude DECIMAL(10,7) NULL,
        Longitude DECIMAL(10,7) NULL,
        ApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_Assignment_ApprovalStatus DEFAULT 'suggested', -- suggested, approved, rejected
        ApprovedBy INT NULL,
        ApprovedAt DATETIME2 NULL,
        RejectedBy INT NULL,
        RejectedAt DATETIME2 NULL,
        ScheduledDate DATE NULL,
        VisitFrequencyDays INT NULL,
        LastVisitDate DATE NULL,
        NextVisitDueDate DATE NULL,
        RouteId BIGINT NULL,
        RouteStopOrder INT NULL,
        AssignmentStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_Assignment_AssignmentStatus DEFAULT 'suggested', -- suggested, approved, routed, checked_in, completed, skipped
        CheckInStatus NVARCHAR(30) NULL,
        CheckedInAt DATETIME2 NULL,
        CheckInLatitude DECIMAL(10,7) NULL,
        CheckInLongitude DECIMAL(10,7) NULL,
        CheckInDistanceMiles DECIMAL(8,2) NULL,
        CompletedAt DATETIME2 NULL,
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Assignment_CreatedDate DEFAULT SYSDATETIME(),
        LastModifiedDate DATETIME2 NULL,
        CONSTRAINT FK_PharmacyFlyer_Assignment_Campaign
            FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
        CONSTRAINT FK_PharmacyFlyer_Assignment_Config
            FOREIGN KEY (ConfigId) REFERENCES dbo.PharmacyFlyer_TargetingRule(ConfigId),
        CONSTRAINT FK_PharmacyFlyer_Assignment_Target
            FOREIGN KEY (TargetId) REFERENCES dbo.PharmacyFlyer_LocationTarget(TargetId)
    );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_Route (
        RouteId BIGINT IDENTITY(1,1) PRIMARY KEY,
        RouteName NVARCHAR(200) NOT NULL,
        StaffUserId INT NOT NULL,
        RouteDate DATE NOT NULL,
        StartAddress NVARCHAR(300) NULL,
        StartLatitude DECIMAL(10,7) NULL,
        StartLongitude DECIMAL(10,7) NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_Status DEFAULT 'planned',
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_CreatedDate DEFAULT SYSDATETIME()
    );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_RouteStop (
        RouteStopId BIGINT IDENTITY(1,1) PRIMARY KEY,
        RouteId BIGINT NOT NULL,
        AssignmentId BIGINT NOT NULL,
        StopOrder INT NOT NULL,
        TargetName NVARCHAR(250) NOT NULL,
        AddressStreet NVARCHAR(300) NULL,
        AddressCity NVARCHAR(100) NULL,
        AddressState NVARCHAR(50) NULL,
        AddressZip NVARCHAR(20) NULL,
        Latitude DECIMAL(10,7) NULL,
        Longitude DECIMAL(10,7) NULL,
        EstimatedDistanceFromPreviousMiles DECIMAL(8,2) NULL,
        StopStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_StopStatus DEFAULT 'pending',
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_CreatedDate DEFAULT SYSDATETIME(),
        CONSTRAINT FK_PharmacyFlyer_RouteStop_Route
            FOREIGN KEY (RouteId) REFERENCES dbo.PharmacyFlyer_Route(RouteId),
        CONSTRAINT FK_PharmacyFlyer_RouteStop_Assignment
            FOREIGN KEY (AssignmentId) REFERENCES dbo.PharmacyFlyer_Assignment(AssignmentId)
    );
END;
GO



/*
  Upgrade guard for databases where a previous/partial version of these tables already exists.
  SQL Server creates indexes only after all referenced columns exist, so add any missing columns first.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_LocationTarget', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'TargetType') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD TargetType NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'DoctorId') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD DoctorId INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'NpiNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD NpiNumber NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'TargetName') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD TargetName NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'PracticeName') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD PracticeName NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'Specialty') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD Specialty NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'DoctorCategory') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD DoctorCategory NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'PrimaryAddressStreet') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD PrimaryAddressStreet NVARCHAR(300) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'PrimaryAddressCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD PrimaryAddressCity NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'PrimaryAddressState') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD PrimaryAddressState NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'PrimaryAddressZip') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD PrimaryAddressZip NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'SecondaryAddressStreet') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD SecondaryAddressStreet NVARCHAR(300) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'SecondaryAddressCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD SecondaryAddressCity NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'SecondaryAddressState') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD SecondaryAddressState NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'SecondaryAddressZip') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD SecondaryAddressZip NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'Phone') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD Phone NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'Fax') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD Fax NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'LicenseNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD LicenseNumber NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'TaxonomyCode') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD TaxonomyCode NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'IsPrimaryTaxonomy') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD IsPrimaryTaxonomy BIT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'TaxonomyDescription') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD TaxonomyDescription NVARCHAR(500) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'MarketNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD MarketNumber NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'GeographyLabel') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD GeographyLabel NVARCHAR(200) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'Latitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD Latitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'Longitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD Longitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'IsActive') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD IsActive BIT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'CreatedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD CreatedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD CreatedDate DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'LastModifiedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD LastModifiedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_LocationTarget', 'LastModifiedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_LocationTarget ADD LastModifiedDate DATETIME2 NULL;

    EXEC('UPDATE dbo.PharmacyFlyer_LocationTarget
          SET TargetType = ISNULL(TargetType, ''Pharmacy''),
              TargetName = ISNULL(TargetName, ''Unspecified target''),
              IsActive = ISNULL(IsActive, 1),
              CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CampaignId') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CampaignId INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'ConfigName') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD ConfigName NVARCHAR(200) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'TargetType') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD TargetType NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'PharmacyNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD PharmacyNumber NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'Specialty') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD Specialty NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CustomSpecialty') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CustomSpecialty NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'DoctorCategory') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD DoctorCategory NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'NpiNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD NpiNumber NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'TargetCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD TargetCity NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'TargetState') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD TargetState NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'MarketNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD MarketNumber NVARCHAR(80) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CenterLatitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CenterLatitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CenterLongitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CenterLongitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'RadiusMiles') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD RadiusMiles DECIMAL(8,2) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'VisitFrequencyDays') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD VisitFrequencyDays INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CheckInRequired') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CheckInRequired BIT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'ProofRequired') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD ProofRequired BIT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'IsActive') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD IsActive BIT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CreatedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CreatedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD CreatedDate DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'LastModifiedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD LastModifiedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'LastModifiedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD LastModifiedDate DATETIME2 NULL;

    EXEC('UPDATE dbo.PharmacyFlyer_TargetingRule
          SET ConfigName = ISNULL(ConfigName, ''Targeting config''),
              TargetType = ISNULL(TargetType, ''Doctor''),
              CheckInRequired = ISNULL(CheckInRequired, 1),
              ProofRequired = ISNULL(ProofRequired, 1),
              IsActive = ISNULL(IsActive, 1),
              CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_Assignment', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CampaignId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CampaignId INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ConfigId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ConfigId BIGINT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'TargetId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD TargetId BIGINT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'DoctorId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD DoctorId INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'StaffUserId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD StaffUserId INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'TargetType') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD TargetType NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'TargetName') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD TargetName NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'PracticeName') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD PracticeName NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Specialty') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Specialty NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'NpiNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD NpiNumber NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressStreet') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressStreet NVARCHAR(300) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressCity NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressState') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressState NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressZip') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressZip NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Phone') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Phone NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Latitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Latitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Longitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Longitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ApprovalStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ApprovalStatus NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ApprovedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ApprovedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ApprovedAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ApprovedAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RejectedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RejectedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RejectedAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RejectedAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ScheduledDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ScheduledDate DATE NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'VisitFrequencyDays') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD VisitFrequencyDays INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'LastVisitDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD LastVisitDate DATE NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'NextVisitDueDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD NextVisitDueDate DATE NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RouteId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RouteId BIGINT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RouteStopOrder') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RouteStopOrder INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AssignmentStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AssignmentStatus NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInStatus NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckedInAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckedInAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInLatitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInLatitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInLongitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInLongitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInDistanceMiles') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInDistanceMiles DECIMAL(8,2) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CompletedAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CompletedAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CreatedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CreatedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CreatedDate DATETIME2 NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'LastModifiedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD LastModifiedDate DATETIME2 NULL;

    EXEC('UPDATE dbo.PharmacyFlyer_Assignment
          SET ApprovalStatus = ISNULL(ApprovalStatus, ''suggested''),
              AssignmentStatus = ISNULL(AssignmentStatus, ''suggested''),
              TargetType = ISNULL(TargetType, ''Doctor''),
              TargetName = ISNULL(TargetName, ''Unspecified target''),
              CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'RouteName') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD RouteName NVARCHAR(200) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StaffUserId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StaffUserId INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'RouteDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD RouteDate DATE NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StartAddress') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StartAddress NVARCHAR(300) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StartLatitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StartLatitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StartLongitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StartLongitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'Status') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD Status NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'CreatedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD CreatedBy INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD CreatedDate DATETIME2 NULL;

    EXEC('UPDATE dbo.PharmacyFlyer_Route
          SET RouteName = ISNULL(RouteName, ''Route''),
              Status = ISNULL(Status, ''planned''),
              CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'RouteId') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD RouteId BIGINT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AssignmentId') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AssignmentId BIGINT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'StopOrder') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD StopOrder INT NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'TargetName') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD TargetName NVARCHAR(250) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressStreet') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressStreet NVARCHAR(300) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressCity NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressState') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressState NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressZip') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressZip NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'Latitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD Latitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'Longitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD Longitude DECIMAL(10,7) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'EstimatedDistanceFromPreviousMiles') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD EstimatedDistanceFromPreviousMiles DECIMAL(8,2) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'StopStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD StopStatus NVARCHAR(30) NULL;
    IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD CreatedDate DATETIME2 NULL;

    EXEC('UPDATE dbo.PharmacyFlyer_RouteStop
          SET TargetName = ISNULL(TargetName, ''Unspecified stop''),
              StopStatus = ISNULL(StopStatus, ''pending''),
              CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'AssignmentId') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD AssignmentId BIGINT NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'RouteId') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD RouteId BIGINT NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'TargetId') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD TargetId BIGINT NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'ProofRequired') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD ProofRequired BIT NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'CompletionStatus') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD CompletionStatus NVARCHAR(30) NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_TargetingRule_Campaign' AND object_id = OBJECT_ID('dbo.PharmacyFlyer_TargetingRule'))
BEGIN
    CREATE INDEX IX_PharmacyFlyer_TargetingRule_Campaign ON dbo.PharmacyFlyer_TargetingRule (CampaignId, IsActive, CreatedDate DESC);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_Assignment_WorkQueue' AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Assignment'))
BEGIN
    CREATE INDEX IX_PharmacyFlyer_Assignment_WorkQueue ON dbo.PharmacyFlyer_Assignment (StaffUserId, ScheduledDate, ApprovalStatus, AssignmentStatus, RouteStopOrder);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_Assignment_TargetDedup' AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Assignment'))
BEGIN
    CREATE INDEX IX_PharmacyFlyer_Assignment_TargetDedup ON dbo.PharmacyFlyer_Assignment (CampaignId, ConfigId, TargetType, DoctorId, TargetId, ApprovalStatus);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_Route_StaffDate' AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Route'))
BEGIN
    CREATE INDEX IX_PharmacyFlyer_Route_StaffDate ON dbo.PharmacyFlyer_Route (StaffUserId, RouteDate, Status);
END;
GO

-- Seed Pinellas Park and St. Petersburg configs once a campaign exists.
DECLARE @DefaultCampaignId INT = (SELECT TOP 1 CampaignId FROM dbo.PharmacyFlyer_Campaign WHERE IsActive = 1 ORDER BY CreatedDate DESC, CampaignId DESC);
IF @DefaultCampaignId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_TargetingRule WHERE ConfigName = 'Pharmacy 1 - 10 mile geography')
    BEGIN
        INSERT INTO dbo.PharmacyFlyer_TargetingRule (CampaignId, ConfigName, TargetType, PharmacyNumber, TargetCity, TargetState, RadiusMiles, VisitFrequencyDays, CheckInRequired, ProofRequired)
        VALUES (@DefaultCampaignId, 'Pharmacy 1 - 10 mile geography', 'Pharmacy', 'Pharmacy 1', 'Pinellas Park', 'FL', 10, 30, 1, 1);
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_TargetingRule WHERE ConfigName = 'Pharmacy 2 - St. Petersburg geography')
    BEGIN
        INSERT INTO dbo.PharmacyFlyer_TargetingRule (CampaignId, ConfigName, TargetType, PharmacyNumber, TargetCity, TargetState, RadiusMiles, VisitFrequencyDays, CheckInRequired, ProofRequired)
        VALUES (@DefaultCampaignId, 'Pharmacy 2 - St. Petersburg geography', 'Pharmacy', 'Pharmacy 2', 'St. Petersburg', 'FL', 15, 30, 1, 1);
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_TargetingRule WHERE ConfigName = 'Endocrinologists around Pinellas Park')
    BEGIN
        INSERT INTO dbo.PharmacyFlyer_TargetingRule (CampaignId, ConfigName, TargetType, Specialty, DoctorCategory, TargetCity, TargetState, RadiusMiles, VisitFrequencyDays, CheckInRequired, ProofRequired)
        VALUES (@DefaultCampaignId, 'Endocrinologists around Pinellas Park', 'Doctor', 'Endocrinologist', 'Specialist', 'Pinellas Park', 'FL', 10, 30, 1, 1);
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_TargetingRule WHERE ConfigName = 'Primary care doctors in St. Petersburg')
    BEGIN
        INSERT INTO dbo.PharmacyFlyer_TargetingRule (CampaignId, ConfigName, TargetType, Specialty, DoctorCategory, TargetCity, TargetState, MarketNumber, RadiusMiles, VisitFrequencyDays, CheckInRequired, ProofRequired)
        VALUES (@DefaultCampaignId, 'Primary care doctors in St. Petersburg', 'Doctor', 'Primary care', 'Primary care', 'St. Petersburg', 'FL', NULL, 15, 30, 1, 1);
    END;
END;
GO
