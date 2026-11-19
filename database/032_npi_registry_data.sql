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
    RegistryProviderId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_NPI_Registry_Data PRIMARY KEY,
    Npi VARCHAR(10) NOT NULL,
    ProviderName NVARCHAR(300) NOT NULL,
    EnumerationDate DATE NULL,
    NpiType VARCHAR(30) NOT NULL,
    Status NVARCHAR(20) NOT NULL,
    AuthOfficialName NVARCHAR(200) NULL,
    AuthOfficialTitle NVARCHAR(100) NULL,
    AuthOfficialPhone VARCHAR(30) NULL,
    MailingStreetLine1 NVARCHAR(200) NULL,
    MailingCity NVARCHAR(100) NULL,
    MailingState VARCHAR(10) NULL,
    MailingPostalCode VARCHAR(20) NULL,
    MailingCountry NVARCHAR(50) NULL,
    MailingPhone VARCHAR(30) NULL,
    MailingFax VARCHAR(30) NULL,
    PrimaryStreetLine1 NVARCHAR(200) NULL,
    PrimaryCity NVARCHAR(100) NULL,
    PrimaryState VARCHAR(10) NULL,
    PrimaryPostalCode VARCHAR(20) NULL,
    PrimaryCountry NVARCHAR(50) NULL,
    PrimaryPhone VARCHAR(30) NULL,
    PrimaryFax VARCHAR(30) NULL,
    SourceRegion VARCHAR(50) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_SourceRegion DEFAULT 'stpt_pinellas',
    ImportedAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_ImportedAt DEFAULT SYSDATETIME()
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_PharmacyFlyer_NPI_Registry_Data_Npi'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data')
)
  CREATE UNIQUE INDEX UX_PharmacyFlyer_NPI_Registry_Data_Npi
  ON dbo.PharmacyFlyer_NPI_Registry_Data (Npi);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NPI_Registry_Data_PrimaryCity'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data')
)
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_PrimaryCity
  ON dbo.PharmacyFlyer_NPI_Registry_Data (PrimaryCity, PrimaryState)
  INCLUDE (ProviderName, NpiType, Status);
GO

IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress (
    SecondaryAddressId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress PRIMARY KEY,
    RegistryProviderId BIGINT NOT NULL,
    SortOrder INT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_SortOrder DEFAULT 1,
    StreetLine1 NVARCHAR(200) NULL,
    City NVARCHAR(100) NULL,
    State VARCHAR(10) NULL,
    PostalCode VARCHAR(20) NULL,
    Country NVARCHAR(50) NULL,
    Phone VARCHAR(30) NULL,
    Fax VARCHAR(30) NULL,
    CONSTRAINT FK_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_Provider
      FOREIGN KEY (RegistryProviderId)
      REFERENCES dbo.PharmacyFlyer_NPI_Registry_Data (RegistryProviderId)
      ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_Provider'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress')
)
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_SecondaryAddress_Provider
  ON dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress (RegistryProviderId, SortOrder);
GO

IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy (
    TaxonomyId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_NPI_Registry_Data_Taxonomy PRIMARY KEY,
    RegistryProviderId BIGINT NOT NULL,
    SortOrder INT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_Taxonomy_SortOrder DEFAULT 1,
    IsPrimary BIT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NPI_Registry_Data_Taxonomy_IsPrimary DEFAULT 0,
    TaxonomyCode VARCHAR(20) NULL,
    TaxonomyDescription NVARCHAR(300) NULL,
    TaxonomyState VARCHAR(10) NULL,
    LicenseNumber VARCHAR(50) NULL,
    CONSTRAINT FK_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Provider
      FOREIGN KEY (RegistryProviderId)
      REFERENCES dbo.PharmacyFlyer_NPI_Registry_Data (RegistryProviderId)
      ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Provider'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy')
)
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Provider
  ON dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy (RegistryProviderId, SortOrder);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Code'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy')
)
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_Taxonomy_Code
  ON dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy (TaxonomyCode, IsPrimary)
  INCLUDE (TaxonomyDescription, TaxonomyState, LicenseNumber);
GO
