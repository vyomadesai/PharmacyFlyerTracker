/*
  Physical stop / flyer drop parent record for Add New entries.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_APPPhysicalStops', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_APPPhysicalStops (
    PhysicalStopId UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT PK_PharmacyFlyer_APPPhysicalStops PRIMARY KEY DEFAULT NEWID(),
    VisitBatchId UNIQUEIDENTIFIER NOT NULL,
    SubmittedByUserId INT NOT NULL,
    PracticeName NVARCHAR(200) NOT NULL,
    LocationAddress NVARCHAR(500) NOT NULL,
    Street NVARCHAR(200) NULL,
    Suite NVARCHAR(100) NULL,
    City NVARCHAR(100) NULL,
    State VARCHAR(10) NULL,
    PostalCode VARCHAR(20) NULL,
    Latitude DECIMAL(10, 7) NULL,
    Longitude DECIMAL(10, 7) NULL,
    DropStatus NVARCHAR(50) NOT NULL,
    StopType NVARCHAR(50) NULL,
    CampaignId INT NULL,
    FlyerTitle NVARCHAR(200) NULL,
    FlyerQuantity INT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_FlyerQuantity DEFAULT 1,
    Notes NVARCHAR(1000) NULL,
    Status NVARCHAR(30) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_Status DEFAULT 'pending',
    CreatedAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPPhysicalStops_UpdatedAt DEFAULT SYSDATETIME()
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPPhysicalStops_VisitBatch'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPPhysicalStops')
)
  CREATE INDEX IX_PharmacyFlyer_APPPhysicalStops_VisitBatch
  ON dbo.PharmacyFlyer_APPPhysicalStops (VisitBatchId, CreatedAt DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPPhysicalStops_User'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPPhysicalStops')
)
  CREATE INDEX IX_PharmacyFlyer_APPPhysicalStops_User
  ON dbo.PharmacyFlyer_APPPhysicalStops (SubmittedByUserId, CreatedAt DESC);
GO
