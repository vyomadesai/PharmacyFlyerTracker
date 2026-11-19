/*
  Geocoded coordinates for NPI registry primary practice addresses.
  Populated by backend-api/scripts/geocode-npi-registry.ts (uses shared Nominatim cache).
*/

IF COL_LENGTH('dbo.PharmacyFlyer_NPI_Registry_Data', 'PrimaryLatitude') IS NULL
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_NPI_Registry_Data
    ADD PrimaryLatitude DECIMAL(10, 7) NULL,
        PrimaryLongitude DECIMAL(10, 7) NULL,
        GeocodedAt DATETIME2 NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_NPI_Registry_Data_Geocode'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data')
)
  CREATE INDEX IX_PharmacyFlyer_NPI_Registry_Data_Geocode
  ON dbo.PharmacyFlyer_NPI_Registry_Data (PrimaryLatitude, PrimaryLongitude)
  INCLUDE (PrimaryStreetLine1, PrimaryCity, PrimaryState, PrimaryPostalCode, Status);
GO
