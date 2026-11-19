import { getPool } from '../src/config/db.js';

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    UPDATE dbo.PharmacyFlyer_NPI_Registry_Data
    SET PrimaryLatitude = NULL,
        PrimaryLongitude = NULL,
        GeocodedAt = NULL
    WHERE PrimaryLatitude IS NOT NULL
      AND (
        (ABS(PrimaryLatitude) < 0.0001 AND ABS(PrimaryLongitude) < 0.0001)
        OR PrimaryLatitude < 24 OR PrimaryLatitude > 31.5
        OR PrimaryLongitude > -79 OR PrimaryLongitude < -88
      )
  `);
  console.log('Reset invalid NPI geocodes:', result.rowsAffected);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
