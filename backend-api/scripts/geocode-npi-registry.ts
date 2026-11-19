import { getPool } from '../src/config/db.js';
import { geocodeUniqueNpiAddresses } from '../src/modules/npi-registry/npiRegistryGeocode.js';

const BATCH_SIZE = 40;

async function main() {
  const pool = await getPool();
  const countResult = await pool.request().query(`
    SELECT COUNT(*) AS PendingCount
    FROM dbo.PharmacyFlyer_NPI_Registry_Data
    WHERE Status = 'Active'
      AND PrimaryLatitude IS NULL
      AND NULLIF(LTRIM(RTRIM(PrimaryStreetLine1)), '') IS NOT NULL
  `);
  const pending = Number(countResult.recordset[0]?.PendingCount) || 0;
  console.log(`Pending geocode rows: ${pending}`);
  if (!pending) {
    console.log('Nothing to geocode.');
    process.exit(0);
  }

  let geocodedTotal = 0;
  while (true) {
    const result = await pool.request().query(`
      SELECT TOP (${BATCH_SIZE})
        LTRIM(RTRIM(ISNULL(PrimaryStreetLine1, ''))) AS Street,
        LTRIM(RTRIM(ISNULL(PrimaryCity, ''))) AS City,
        LTRIM(RTRIM(ISNULL(PrimaryState, 'FL'))) AS State,
        LEFT(REPLACE(ISNULL(PrimaryPostalCode, ''), ' ', ''), 5) AS PostalCode
      FROM dbo.PharmacyFlyer_NPI_Registry_Data
      WHERE Status = 'Active'
        AND PrimaryLatitude IS NULL
        AND NULLIF(LTRIM(RTRIM(PrimaryStreetLine1)), '') IS NOT NULL
      GROUP BY
        LTRIM(RTRIM(ISNULL(PrimaryStreetLine1, ''))),
        LTRIM(RTRIM(ISNULL(PrimaryCity, ''))),
        LTRIM(RTRIM(ISNULL(PrimaryState, 'FL'))),
        LEFT(REPLACE(ISNULL(PrimaryPostalCode, ''), ' ', ''), 5)
      ORDER BY PostalCode, Street
    `);

    const rows = result.recordset as Array<{
      Street?: string;
      City?: string;
      State?: string;
      PostalCode?: string;
    }>;
    if (!rows.length) break;

    const updates = await geocodeUniqueNpiAddresses(
      rows.map((row) => ({
        street: String(row.Street || '').trim() || null,
        city: String(row.City || '').trim() || null,
        state: String(row.State || 'FL').trim() || 'FL',
        postalCode: String(row.PostalCode || '').trim() || null,
      })),
      { minDelaySeconds: 0.5 },
    );

    for (const update of updates) {
      await pool.request()
        .input('Street', update.street)
        .input('City', update.city)
        .input('State', update.state)
        .input('PostalCode', update.postalCode)
        .input('Latitude', update.latitude)
        .input('Longitude', update.longitude)
        .query(`
          UPDATE dbo.PharmacyFlyer_NPI_Registry_Data
          SET PrimaryLatitude = @Latitude,
              PrimaryLongitude = @Longitude,
              GeocodedAt = SYSDATETIME()
          WHERE Status = 'Active'
            AND PrimaryLatitude IS NULL
            AND LTRIM(RTRIM(ISNULL(PrimaryStreetLine1, ''))) = @Street
            AND LTRIM(RTRIM(ISNULL(PrimaryCity, ''))) = ISNULL(@City, '')
            AND LTRIM(RTRIM(ISNULL(PrimaryState, 'FL'))) = @State
            AND LEFT(REPLACE(ISNULL(PrimaryPostalCode, ''), ' ', ''), 5) = ISNULL(@PostalCode, '')
        `);
      geocodedTotal += 1;
    }

    console.log(`Geocoded batch: ${updates.length} unique addresses (${geocodedTotal} total this run)`);
    if (rows.length < BATCH_SIZE) break;
  }

  const remaining = await pool.request().query(`
    SELECT COUNT(*) AS PendingCount
    FROM dbo.PharmacyFlyer_NPI_Registry_Data
    WHERE Status = 'Active' AND PrimaryLatitude IS NULL
  `);
  console.log('Remaining without coordinates:', remaining.recordset[0]?.PendingCount);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
