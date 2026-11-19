/*
  Automated location holds for multi-rep route planner (V2).

  While a rep is checked in, pending stops on their route hold the locationKey
  so other reps skip it at check-in. Holds release on check-out, stop completion,
  or stale-session cleanup.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_LocationHoldV2 (
    LocationHoldId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_PharmacyFlyer_LocationHoldV2 PRIMARY KEY,
    LocationKey NVARCHAR(200) NOT NULL,
    PlanDate DATE NOT NULL,
    HeldByUserId INT NOT NULL,
    RouteCheckInId BIGINT NULL,
    RoutePlanId BIGINT NULL,
    RoutePlanStopId BIGINT NULL,
    HeldAt DATETIME2 NOT NULL
      CONSTRAINT DF_PharmacyFlyer_LocationHoldV2_HeldAt DEFAULT SYSDATETIME(),
    ReleasedAt DATETIME2 NULL
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'UX_PharmacyFlyer_LocationHoldV2_Active'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2')
)
  CREATE UNIQUE INDEX UX_PharmacyFlyer_LocationHoldV2_Active
  ON dbo.PharmacyFlyer_LocationHoldV2 (LocationKey, PlanDate)
  WHERE ReleasedAt IS NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_LocationHoldV2_CheckIn'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2')
)
  CREATE INDEX IX_PharmacyFlyer_LocationHoldV2_CheckIn
  ON dbo.PharmacyFlyer_LocationHoldV2 (RouteCheckInId, ReleasedAt)
  WHERE RouteCheckInId IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_LocationHoldV2_UserDate'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_LocationHoldV2')
)
  CREATE INDEX IX_PharmacyFlyer_LocationHoldV2_UserDate
  ON dbo.PharmacyFlyer_LocationHoldV2 (HeldByUserId, PlanDate, ReleasedAt);
GO
