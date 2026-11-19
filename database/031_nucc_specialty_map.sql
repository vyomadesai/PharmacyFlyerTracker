/*
  Bridge NUCC taxonomy codes/descriptions (NPI registry) to internal prescriber
  specialties (Master_PrsSpecialitiesList.RecID). Used by new-entry flyer recommendations.
  Do NOT map internal RR — * routing codes here; those are not NUCC taxonomies.

  Note: Master_PrsSpecialitiesList.RecID is not a declared PK in this database, so we
  store SpecialityRecID without a FK (same pattern as PharmacyFlyer_CampaignSpecialtyV2).
*/

IF OBJECT_ID('dbo.PharmacyFlyer_NuccSpecialtyMap', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_NuccSpecialtyMap (
    NuccSpecialtyMapId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_NuccSpecialtyMap PRIMARY KEY,
    TaxonomyCode VARCHAR(20) NULL,
    TaxonomyDescPattern NVARCHAR(300) NULL,
    SpecialityRecID INT NOT NULL,
    Priority INT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NuccSpecialtyMap_Priority DEFAULT 100,
    IsActive BIT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NuccSpecialtyMap_IsActive DEFAULT 1,
    Notes NVARCHAR(500) NULL,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_NuccSpecialtyMap_CreatedDate DEFAULT SYSDATETIME(),
    CONSTRAINT CK_PharmacyFlyer_NuccSpecialtyMap_HasKey
      CHECK (TaxonomyCode IS NOT NULL OR TaxonomyDescPattern IS NOT NULL)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NuccSpecialtyMap_TaxonomyCode'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NuccSpecialtyMap')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_NuccSpecialtyMap_TaxonomyCode
  ON dbo.PharmacyFlyer_NuccSpecialtyMap (TaxonomyCode, IsActive)
  INCLUDE (SpecialityRecID, Priority, TaxonomyDescPattern);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NuccSpecialtyMap_SpecialityRecID'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NuccSpecialtyMap')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_NuccSpecialtyMap_SpecialityRecID
  ON dbo.PharmacyFlyer_NuccSpecialtyMap (SpecialityRecID, IsActive)
  INCLUDE (TaxonomyCode, TaxonomyDescPattern, Priority);
END;
GO

/*
  Example seed rows (adjust SpecialityRecID to match your Master_PrsSpecialitiesList).
  Uncomment and edit RecIDs after verifying in your environment.

INSERT INTO dbo.PharmacyFlyer_NuccSpecialtyMap (TaxonomyCode, TaxonomyDescPattern, SpecialityRecID, Priority, Notes)
SELECT v.TaxonomyCode, v.TaxonomyDescPattern, sl.RecID, v.Priority, v.Notes
FROM (VALUES
  ('207Q00000X', NULL, 100, 'Family Medicine NUCC'),
  ('207R00000X', NULL, 100, 'Internal Medicine NUCC'),
  ('207RC0000X', NULL, 100, 'Cardiovascular Disease NUCC'),
  ('207RE0101X', NULL, 100, 'Endocrinology/Diabetes NUCC'),
  (NULL, '%FAMILY MEDICINE%', 100, 'Family Medicine desc'),
  (NULL, '%INTERNAL MEDICINE%', 100, 'Internal Medicine desc'),
  (NULL, '%CARDIOLOGY%', 100, 'Cardiology desc'),
  (NULL, '%ENDOCRIN%', 100, 'Endocrinology desc')
) AS v(TaxonomyCode, TaxonomyDescPattern, Priority, Notes)
INNER JOIN dbo.Master_PrsSpecialitiesList sl
  ON UPPER(LTRIM(RTRIM(sl.SpecialityCode))) = 'PHC'
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PharmacyFlyer_NuccSpecialtyMap m
  WHERE ISNULL(m.TaxonomyCode, '') = ISNULL(v.TaxonomyCode, '')
    AND ISNULL(m.TaxonomyDescPattern, '') = ISNULL(v.TaxonomyDescPattern, '')
);
*/
