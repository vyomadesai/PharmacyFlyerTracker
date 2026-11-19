/*
  Global pharmacy territory for Route Planner V2.

  Defines the eligible doctor universe: all locations within RadiusMiles of the
  pharmacy center. Reps build optimized routes from their GPS through due stops
  in this territory — rep location does NOT shrink eligibility.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_RouteTerritoryV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_RouteTerritoryV2 (
    TerritoryId INT NOT NULL
      CONSTRAINT PK_PharmacyFlyer_RouteTerritoryV2 PRIMARY KEY
      CONSTRAINT DF_PharmacyFlyer_RouteTerritoryV2_TerritoryId DEFAULT 1,
    PharmacyId INT NULL,
    CenterLabel NVARCHAR(300) NULL,
    CenterAddress NVARCHAR(300) NULL,
    CenterLatitude DECIMAL(10, 7) NULL,
    CenterLongitude DECIMAL(10, 7) NULL,
    RadiusMiles DECIMAL(8, 2) NOT NULL
      CONSTRAINT DF_PharmacyFlyer_RouteTerritoryV2_RadiusMiles DEFAULT 30,
    UpdatedAt DATETIME2 NULL,
    UpdatedBy INT NULL,
    CONSTRAINT CK_PharmacyFlyer_RouteTerritoryV2_SingleRow CHECK (TerritoryId = 1)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_RouteTerritoryV2 WHERE TerritoryId = 1)
BEGIN
  INSERT INTO dbo.PharmacyFlyer_RouteTerritoryV2 (TerritoryId, RadiusMiles)
  VALUES (1, 30);
END;
GO
