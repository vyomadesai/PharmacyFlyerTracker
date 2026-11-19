/*
  NPI Registery admin-selected configuration table.
  This script creates only dbo.npiRegisteryConfig.
  It does not alter dbo.Master_Doctor or any existing PharmacyFlyer tables.
*/

IF OBJECT_ID('dbo.npiRegisteryConfig', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.npiRegisteryConfig
  (
    ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_npiRegisteryConfig PRIMARY KEY,
    NPI VARCHAR(10) NOT NULL,
    MasterDoctorID INT NULL,
    SelectedSource VARCHAR(30) NOT NULL,

    FirstName NVARCHAR(100) NULL,
    MiddleName NVARCHAR(100) NULL,
    LastName NVARCHAR(100) NULL,
    Credential NVARCHAR(50) NULL,
    Sex VARCHAR(10) NULL,
    LicenseNumber VARCHAR(50) NULL,
    TaxonomyCode VARCHAR(20) NULL,
    TaxonomyDesc NVARCHAR(255) NULL,

    Address1 NVARCHAR(200) NULL,
    Address2 NVARCHAR(200) NULL,
    City NVARCHAR(100) NULL,
    State VARCHAR(10) NULL,
    PostalCode VARCHAR(20) NULL,
    Phone VARCHAR(30) NULL,
    Fax VARCHAR(30) NULL,

    NppesLastUpdated DATE NULL,
    RegistryFetchedAt DATETIME2 NULL,

    MasterDoctorJson NVARCHAR(MAX) NULL,
    NpiRegistryJson NVARCHAR(MAX) NULL,
    SelectedJson NVARCHAR(MAX) NULL,
    ComparisonJson NVARCHAR(MAX) NULL,

    CreatedBy NVARCHAR(100) NULL,
    UpdatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_npiRegisteryConfig_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_npiRegisteryConfig_UpdatedAt DEFAULT SYSUTCDATETIME()
  );

  CREATE UNIQUE INDEX UX_npiRegisteryConfig_NPI ON dbo.npiRegisteryConfig(NPI);
END;
