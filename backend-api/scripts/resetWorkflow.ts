import { getPool } from '../src/config/db.js';

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

    DECLARE @proofs INT = 0, @checkins INT = 0, @deliveryPhotos INT = 0,
            @deliveries INT = 0, @stops INT = 0, @routes INT = 0, @assignments INT = 0;

    IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_RouteStopProof; SET @proofs = @@ROWCOUNT; END
    IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_RouteStopCheckIn; SET @checkins = @@ROWCOUNT; END
    IF OBJECT_ID('dbo.PharmacyFlyer_DeliveryPhoto','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_DeliveryPhoto; SET @deliveryPhotos = @@ROWCOUNT; END
    IF OBJECT_ID('dbo.PharmacyFlyer_Delivery','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_Delivery; SET @deliveries = @@ROWCOUNT; END
    IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_RouteStop; SET @stops = @@ROWCOUNT; END
    IF OBJECT_ID('dbo.PharmacyFlyer_Route','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_Route; SET @routes = @@ROWCOUNT; END
    IF OBJECT_ID('dbo.PharmacyFlyer_Assignment','U') IS NOT NULL
      BEGIN DELETE FROM dbo.PharmacyFlyer_Assignment; SET @assignments = @@ROWCOUNT; END

    COMMIT TRANSACTION;

    SELECT @proofs AS routeStopProofs, @checkins AS routeStopCheckIns,
           @deliveryPhotos AS deliveryPhotos, @deliveries AS deliveries,
           @stops AS routeStops, @routes AS routes, @assignments AS assignments;
  `);
  console.log('Reset complete. Deleted:');
  console.table(result.recordset);
  process.exit(0);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
