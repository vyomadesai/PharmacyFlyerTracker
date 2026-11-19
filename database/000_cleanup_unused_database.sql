/*
  Pharmacy Flyer Tracker — database cleanup (run manually in SSMS)

  Current app connection (backend-api/.env):
    DB_SERVER = HEALTHMEDIT_1
    DB_NAME   = MyDosePackSQL_OLD

  This project does NOT create its own SQL Server database. It adds
  PharmacyFlyer_* tables into an existing MyDosePack database that already
  has Master_User, Master_Doctor, etc.

  Review every result set before running any DROP statement.
*/

/* ------------------------------------------------------------------
   STEP 1 — List all user databases on this server
   ------------------------------------------------------------------ */
SELECT
  d.name AS DatabaseName,
  d.create_date,
  d.state_desc,
  CAST(SUM(mf.size) * 8.0 / 1024 AS DECIMAL(18, 2)) AS SizeMB
FROM sys.databases d
LEFT JOIN sys.master_files mf ON mf.database_id = d.database_id
WHERE d.database_id > 4          -- exclude system DBs
  AND d.name NOT IN ('ReportServer', 'ReportServerTempDB')
GROUP BY d.name, d.create_date, d.state_desc
ORDER BY d.name;

/* ------------------------------------------------------------------
   STEP 2 — Find databases that contain PharmacyFlyer tables
   (helps spot dev/test copies you may no longer need)
   ------------------------------------------------------------------ */
DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql + N'
USE [' + name + N'];
IF EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name LIKE ''PharmacyFlyer_%'' OR name = ''npiRegisteryConfig''
)
  SELECT ''' + name + N''' AS DatabaseWithFlyerTables, COUNT(*) AS FlyerTableCount
  FROM sys.tables
  WHERE name LIKE ''PharmacyFlyer_%'' OR name = ''npiRegisteryConfig'';
'
FROM sys.databases
WHERE database_id > 4
  AND state_desc = 'ONLINE';

EXEC sys.sp_executesql @sql;

/* ------------------------------------------------------------------
   STEP 3 — Inspect the ACTIVE database configured in .env
   Replace the USE database name if you changed DB_NAME in .env
   ------------------------------------------------------------------ */
USE [MyDosePackSQL_OLD];
GO

SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
  AND (TABLE_NAME LIKE 'PharmacyFlyer_%' OR TABLE_NAME = 'npiRegisteryConfig')
ORDER BY TABLE_NAME;

/* ------------------------------------------------------------------
   STEP 4A — DROP an entire unused TEST database (only if it is a copy
   you created for this project and nothing else uses it)

   !!! DO NOT run this on MyDosePackSQL or MyDosePackSQL_OLD unless you
   are certain the whole database is disposable. They contain Master_User,
   Master_Doctor, and other production tables.

   Uncomment and edit the name before running:
   ------------------------------------------------------------------ */
/*
ALTER DATABASE [YourUnusedTestDatabaseName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [YourUnusedTestDatabaseName];
*/

/* Example: drop a dedicated flyer-only sandbox IF you created one */
/*
ALTER DATABASE [PharmacyFlyerTracker_Test] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [PharmacyFlyerTracker_Test];
*/

/* ------------------------------------------------------------------
   STEP 4B — Remove ONLY PharmacyFlyer objects from the shared database
   (keeps Master_User, Master_Doctor, and all other MyDosePack tables)

   Run this when uninstalling the flyer feature but keeping MyDosePackSQL_OLD.
   ------------------------------------------------------------------ */
/*
USE [MyDosePackSQL_OLD];
GO

BEGIN TRANSACTION;

IF OBJECT_ID('dbo.PharmacyFlyer_DeliveryPhoto', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_DeliveryPhoto;
IF OBJECT_ID('dbo.PharmacyFlyer_Delivery', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_Delivery;
IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_RouteStopProof;
IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_RouteStopCheckIn;
IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_RouteStop;
IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_Route;
IF OBJECT_ID('dbo.PharmacyFlyer_Assignment', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_Assignment;
IF OBJECT_ID('dbo.PharmacyFlyer_DistributorBatchStop', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_DistributorBatchStop;
IF OBJECT_ID('dbo.PharmacyFlyer_DistributorInventory', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_DistributorInventory;
IF OBJECT_ID('dbo.PharmacyFlyer_DistributorAssignmentBatch', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_DistributorAssignmentBatch;
IF OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_CampaignTarget;
IF OBJECT_ID('dbo.PharmacyFlyer_CampaignConfig', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_CampaignConfig;
IF OBJECT_ID('dbo.PharmacyFlyer_CampaignSpecialtyMapping', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_CampaignSpecialtyMapping;
IF OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_TargetingRule;
IF OBJECT_ID('dbo.PharmacyFlyer_LocationTarget', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_LocationTarget;
IF OBJECT_ID('dbo.PharmacyFlyer_Pharmacy', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_Pharmacy;
IF OBJECT_ID('dbo.PharmacyFlyer_Market', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_Market;
IF OBJECT_ID('dbo.PharmacyFlyer_UserProfile', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_UserProfile;
IF OBJECT_ID('dbo.PharmacyFlyer_Campaign', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_Campaign;
IF OBJECT_ID('dbo.PharmacyFlyer_DoctorInfo', 'U') IS NOT NULL DROP TABLE dbo.PharmacyFlyer_DoctorInfo;
IF OBJECT_ID('dbo.npiRegisteryConfig', 'U') IS NOT NULL DROP TABLE dbo.npiRegisteryConfig;

COMMIT TRANSACTION;
*/

/* ------------------------------------------------------------------
   STEP 4C — Reset flyer DATA only (keep tables/schema for re-use)
   Same as database/016_reconcile_workflow_counts_pinellas_st_pete.sql
   ------------------------------------------------------------------ */
/*
USE [MyDosePackSQL_OLD];
GO
:r database/016_reconcile_workflow_counts_pinellas_st_pete.sql
*/
