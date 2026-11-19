/*
  Specialty-based flyer workflow using EXISTING project tables.

  Existing tables reused:
    dbo.Master_Doctor
    dbo.PharmacyFlyer_DoctorInfo          -- source of [pri-spec]
    dbo.PharmacyFlyer_Campaign            -- existing flyer/campaign master
    dbo.PharmacyFlyer_Delivery            -- existing visit/check-in/assignment record
    dbo.PharmacyFlyer_DeliveryPhoto       -- existing uploaded photo storage

  New table added only where a true many-to-many mapping is missing:
    dbo.PharmacyFlyer_CampaignSpecialtyMapping

  Important business rule:
    Flyers/campaigns are NOT assigned directly from raw [pri-spec].
    dbo.PharmacyFlyer_DoctorInfo.[pri-spec] is used as the source specialty value,
    then assignment goes through dbo.PharmacyFlyer_CampaignSpecialtyMapping.
*/

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerIdentifier') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD FlyerIdentifier NVARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerCategory') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD FlyerCategory NVARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'IsDefaultFallback') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD IsDefaultFallback BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_Campaign_IsDefaultFallback DEFAULT 0;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'MatchTitle') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD MatchTitle NVARCHAR(200) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'MatchIdentifier') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Campaign ADD MatchIdentifier NVARCHAR(100) NULL;
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyMapping', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_CampaignSpecialtyMapping (
        CampaignSpecialtyId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CampaignId INT NOT NULL,
        PriSpec NVARCHAR(300) NOT NULL,
        RelevanceScore INT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyMapping_RelevanceScore DEFAULT 100,
        IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyMapping_IsActive DEFAULT 1,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignSpecialtyMapping_CreatedDate DEFAULT SYSDATETIME(),
        CONSTRAINT FK_PharmacyFlyer_CampaignSpecialtyMapping_Campaign
            FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
        CONSTRAINT UQ_PharmacyFlyer_CampaignSpecialtyMapping_Campaign_PriSpec
            UNIQUE (CampaignId, PriSpec)
    );
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'CheckInStatus') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD CheckInStatus NVARCHAR(30) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'CheckInConfirmedAt') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD CheckInConfirmedAt DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'AssignedCampaignId') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD AssignedCampaignId INT NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'AssignedAt') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD AssignedAt DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'AssignmentPriSpec') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD AssignmentPriSpec NVARCHAR(300) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'DistanceMiles') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD DistanceMiles DECIMAL(8, 2) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'MatchStatus') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD MatchStatus NVARCHAR(30) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_Delivery', 'MatchCheckedAt') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_Delivery ADD MatchCheckedAt DATETIME2 NULL;
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_DeliveryPhoto', 'ExtractedTitle') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_DeliveryPhoto ADD ExtractedTitle NVARCHAR(200) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_DeliveryPhoto', 'ExtractedCategory') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_DeliveryPhoto ADD ExtractedCategory NVARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_DeliveryPhoto', 'ExtractedIdentifier') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_DeliveryPhoto ADD ExtractedIdentifier NVARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_DeliveryPhoto', 'MatchStatus') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_DeliveryPhoto ADD MatchStatus NVARCHAR(30) NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_DeliveryPhoto', 'MatchCheckedAt') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_DeliveryPhoto ADD MatchCheckedAt DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.PharmacyFlyer_DeliveryPhoto', 'MatchNotes') IS NULL
BEGIN
    ALTER TABLE dbo.PharmacyFlyer_DeliveryPhoto ADD MatchNotes NVARCHAR(1000) NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_CampaignSpecialtyMapping_PriSpec' AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyMapping'))
BEGIN
    CREATE INDEX IX_PharmacyFlyer_CampaignSpecialtyMapping_PriSpec
    ON dbo.PharmacyFlyer_CampaignSpecialtyMapping (PriSpec, IsActive, RelevanceScore DESC);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_Delivery_Assignment' AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Delivery'))
BEGIN
    CREATE INDEX IX_PharmacyFlyer_Delivery_Assignment
    ON dbo.PharmacyFlyer_Delivery (StaffUserId, AssignedCampaignId, CheckInStatus, SubmittedAt DESC);
END;
GO
