/*
  Location-based visit frequency (V2).

  Visit Frequency is the number of days between sales-rep visits to a physical
  location. It is a scheduling helper: Next Visit Date = Last Visit Date +
  VisitFrequencyDays, where Last Visit Date is computed from the most recent
  completed flyer drop / delivery at that location.

  This REPLACES the old per-campaign PharmacyFlyer_Campaign.FrequencyInDays
  concept. Frequency is now keyed by the route planner's stable LocationKey
  (e.g. "geo:27.7712,-82.6586", "loc:123", "addr:...|33713").
*/

IF OBJECT_ID('dbo.PharmacyFlyer_LocationVisitV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_LocationVisitV2 (
    LocationVisitV2Id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_LocationVisitV2 PRIMARY KEY,
    LocationKey NVARCHAR(200) NOT NULL,
    VisitFrequencyDays INT NOT NULL
      CONSTRAINT DF_PharmacyFlyer_LocationVisitV2_Freq DEFAULT 30,
    CreatedDate DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_LocationVisitV2_Created DEFAULT SYSDATETIME(),
    LastModifiedDate DATETIME2 NULL
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'UX_PharmacyFlyer_LocationVisitV2_LocationKey'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationVisitV2')
)
  CREATE UNIQUE INDEX UX_PharmacyFlyer_LocationVisitV2_LocationKey
  ON dbo.PharmacyFlyer_LocationVisitV2 (LocationKey);
GO
