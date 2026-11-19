/*
  Route stop check-in and proof upload for distributor mobile workflow.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RouteStopCheckIn (
    RouteStopCheckInId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RouteStopCheckIn PRIMARY KEY,
    RouteStopId INT NOT NULL,
    DistributorUserId INT NOT NULL,
    CheckInLatitude DECIMAL(10, 7) NULL,
    CheckInLongitude DECIMAL(10, 7) NULL,
    GpsAccuracyMeters DECIMAL(10, 2) NULL,
    TargetLatitude DECIMAL(10, 7) NULL,
    TargetLongitude DECIMAL(10, 7) NULL,
    DistanceMiles DECIMAL(8, 2) NULL,
    LocationVerified BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStopCheckIn_LocationVerified DEFAULT 0,
    VerificationNote NVARCHAR(500) NULL,
    CheckedInAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStopCheckIn_CheckedInAt DEFAULT SYSDATETIME(),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStopCheckIn_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_RouteStopCheckIn_Stop FOREIGN KEY (RouteStopId) REFERENCES dbo.PharmacyFlyer_RouteStop(RouteStopId) ON DELETE CASCADE
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RouteStopProof (
    RouteStopProofId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_RouteStopProof PRIMARY KEY,
    RouteStopId INT NOT NULL,
    UploadedByUserId INT NOT NULL,
    FileName NVARCHAR(255) NULL,
    ContentType NVARCHAR(100) NULL,
    FileSizeBytes BIGINT NULL,
    PhotoData VARBINARY(MAX) NOT NULL,
    UploadedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStopProof_UploadedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_RouteStopProof_Stop FOREIGN KEY (RouteStopId) REFERENCES dbo.PharmacyFlyer_RouteStop(RouteStopId) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RouteStopCheckIn_RouteStopId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn')
)
  CREATE UNIQUE INDEX IX_PharmacyFlyer_RouteStopCheckIn_RouteStopId
  ON dbo.PharmacyFlyer_RouteStopCheckIn (RouteStopId);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_RouteStopProof_RouteStopId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof')
)
  CREATE INDEX IX_PharmacyFlyer_RouteStopProof_RouteStopId
  ON dbo.PharmacyFlyer_RouteStopProof (RouteStopId, UploadedAt DESC);
GO
