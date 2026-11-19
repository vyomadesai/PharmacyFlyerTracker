/*
  Field-discovered doctors: reps submit practice/address details + optional
  business card photo while on route. Admin reviews in New Entries.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_NewDoctorEntryV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_NewDoctorEntryV2 (
    NewDoctorEntryId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_NewDoctorEntryV2 PRIMARY KEY,
    SubmittedByUserId INT NOT NULL,
    PracticeName NVARCHAR(200) NOT NULL,
    LocationAddress NVARCHAR(500) NOT NULL,
    ProviderAddress NVARCHAR(500) NOT NULL,
    Latitude DECIMAL(10, 7) NULL,
    Longitude DECIMAL(10, 7) NULL,
    Status NVARCHAR(30) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NewDoctorEntryV2_Status DEFAULT 'pending',
    SubmittedAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NewDoctorEntryV2_SubmittedAt DEFAULT SYSDATETIME()
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_NewDoctorEntryPhotoV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_NewDoctorEntryPhotoV2 (
    PhotoId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_NewDoctorEntryPhotoV2 PRIMARY KEY,
    NewDoctorEntryId BIGINT NOT NULL,
    FileName NVARCHAR(255) NULL,
    ContentType NVARCHAR(100) NULL,
    FileSizeBytes BIGINT NULL,
    PhotoData VARBINARY(MAX) NOT NULL,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NewDoctorEntryPhotoV2_CreatedDate DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_NewDoctorEntryPhotoV2_Entry
      FOREIGN KEY (NewDoctorEntryId) REFERENCES dbo.PharmacyFlyer_NewDoctorEntryV2(NewDoctorEntryId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_NewDoctorEntryV2_User'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NewDoctorEntryV2')
)
  CREATE INDEX IX_PharmacyFlyer_NewDoctorEntryV2_User
  ON dbo.PharmacyFlyer_NewDoctorEntryV2 (SubmittedByUserId, SubmittedAt DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_NewDoctorEntryV2_SubmittedAt'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NewDoctorEntryV2')
)
  CREATE INDEX IX_PharmacyFlyer_NewDoctorEntryV2_SubmittedAt
  ON dbo.PharmacyFlyer_NewDoctorEntryV2 (SubmittedAt DESC);
GO
