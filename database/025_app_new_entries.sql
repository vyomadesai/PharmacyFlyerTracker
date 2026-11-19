/*
  Mobile "Add New" entries from field reps.
  Admin reviews at /new-entries.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_APPNewEntries (
    AppNewEntryId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_APPNewEntries PRIMARY KEY,
    SubmittedByUserId INT NOT NULL,
    PracticeName NVARCHAR(200) NOT NULL,
    LocationAddress NVARCHAR(500) NOT NULL,
    ProviderName NVARCHAR(200) NOT NULL,
    ProviderAddress NVARCHAR(500) NOT NULL,
    NpiNumber VARCHAR(20) NULL,
    Phone VARCHAR(30) NULL,
    TaxonomyDesc NVARCHAR(255) NULL,
    Latitude DECIMAL(10, 7) NULL,
    Longitude DECIMAL(10, 7) NULL,
    Status NVARCHAR(30) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPNewEntries_Status DEFAULT 'pending',
    SubmittedAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPNewEntries_SubmittedAt DEFAULT SYSDATETIME()
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_APPNewEntryPhoto', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_APPNewEntryPhoto (
    PhotoId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_APPNewEntryPhoto PRIMARY KEY,
    AppNewEntryId BIGINT NOT NULL,
    FileName NVARCHAR(255) NULL,
    ContentType NVARCHAR(100) NULL,
    FileSizeBytes BIGINT NULL,
    PhotoData VARBINARY(MAX) NOT NULL,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPNewEntryPhoto_CreatedDate DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_APPNewEntryPhoto_Entry
      FOREIGN KEY (AppNewEntryId) REFERENCES dbo.PharmacyFlyer_APPNewEntries(AppNewEntryId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPNewEntries_User'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries')
)
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_User
  ON dbo.PharmacyFlyer_APPNewEntries (SubmittedByUserId, SubmittedAt DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPNewEntries_SubmittedAt'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPNewEntries')
)
  CREATE INDEX IX_PharmacyFlyer_APPNewEntries_SubmittedAt
  ON dbo.PharmacyFlyer_APPNewEntries (SubmittedAt DESC);
GO
