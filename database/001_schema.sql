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
        CampaignId INT IDENTITY(1,1) PRIMARY KEY,
        CampaignName NVARCHAR(200) NOT NULL,
        Description NVARCHAR(1000) NULL,
        StartDate DATE NULL,
        EndDate DATE NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedBy INT NULL, -- Master_User.ID
        CreatedDate DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        LastModifiedBy INT NULL, -- Master_User.ID
        LastModifiedDate DATETIME2 NULL
    );
END;

IF OBJECT_ID('dbo.PharmacyFlyer_Delivery', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_Delivery (
        DeliveryId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CampaignId INT NOT NULL,
        DoctorId INT NULL, -- Master_Doctor.ID
        StaffUserId INT NOT NULL, -- Master_User.ID
        DoctorName NVARCHAR(200) NULL,
        ClinicName NVARCHAR(200) NULL,
        DoctorAddressStreet NVARCHAR(300) NULL,
        DoctorAddressCity NVARCHAR(100) NULL,
        DoctorAddressState NVARCHAR(50) NULL,
        DoctorAddressZip NVARCHAR(20) NULL,
        PersonMet NVARCHAR(50) NULL,
        FlyerDelivered BIT NOT NULL DEFAULT 1,
        ResponseStatus NVARCHAR(50) NULL,
        Latitude DECIMAL(10, 7) NOT NULL,
        Longitude DECIMAL(10, 7) NOT NULL,
        GpsAccuracyMeters DECIMAL(10, 2) NULL,
        Notes NVARCHAR(1000) NULL,
        FollowUpRequired BIT NOT NULL DEFAULT 0,
        FollowUpDate DATE NULL,
        SubmittedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CreatedDate DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT FK_PharmacyFlyer_Delivery_Campaign
            FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
    );
END;

IF OBJECT_ID('dbo.PharmacyFlyer_DeliveryPhoto', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PharmacyFlyer_DeliveryPhoto (
        PhotoId BIGINT IDENTITY(1,1) PRIMARY KEY,
        DeliveryId BIGINT NOT NULL,
        FileName NVARCHAR(255) NULL,
        ContentType NVARCHAR(100) NULL,
        FileSizeBytes BIGINT NULL,
        PhotoData VARBINARY(MAX) NOT NULL,
        CreatedDate DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT FK_PharmacyFlyer_DeliveryPhoto_Delivery
            FOREIGN KEY (DeliveryId) REFERENCES dbo.PharmacyFlyer_Delivery(DeliveryId)
    );
END;
GO

CREATE INDEX IX_PharmacyFlyer_Delivery_Campaign_SubmittedAt
ON dbo.PharmacyFlyer_Delivery (CampaignId, SubmittedAt DESC);
GO

CREATE INDEX IX_PharmacyFlyer_Delivery_Staff_SubmittedAt
ON dbo.PharmacyFlyer_Delivery (StaffUserId, SubmittedAt DESC);
GO
