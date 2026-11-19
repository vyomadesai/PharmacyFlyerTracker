/*
  NPI-2 organization links to a physical stop (enrichment, not flyer count).
*/

IF OBJECT_ID('dbo.PharmacyFlyer_APPVisitOrgLinks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_APPVisitOrgLinks (
    Id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_APPVisitOrgLinks PRIMARY KEY,
    PhysicalStopId UNIQUEIDENTIFIER NOT NULL,
    VisitBatchId UNIQUEIDENTIFIER NOT NULL,
    OrganizationNpi VARCHAR(20) NOT NULL,
    OrganizationName NVARCHAR(200) NOT NULL,
    OrganizationAddress NVARCHAR(500) NULL,
    TaxonomyCode VARCHAR(20) NULL,
    TaxonomyDescription NVARCHAR(255) NULL,
    DistanceMiles DECIMAL(8, 2) NULL,
    SuiteLabel NVARCHAR(100) NULL,
    VerificationStatus NVARCHAR(50) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPVisitOrgLinks_VerificationStatus DEFAULT 'npi_only',
    FlyerAttributed BIT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPVisitOrgLinks_FlyerAttributed DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_APPVisitOrgLinks_CreatedAt DEFAULT SYSDATETIME()
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPVisitOrgLinks_PhysicalStop'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPVisitOrgLinks')
)
  CREATE INDEX IX_PharmacyFlyer_APPVisitOrgLinks_PhysicalStop
  ON dbo.PharmacyFlyer_APPVisitOrgLinks (PhysicalStopId, CreatedAt DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_APPVisitOrgLinks_VisitBatch'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_APPVisitOrgLinks')
)
  CREATE INDEX IX_PharmacyFlyer_APPVisitOrgLinks_VisitBatch
  ON dbo.PharmacyFlyer_APPVisitOrgLinks (VisitBatchId, CreatedAt DESC);
GO
