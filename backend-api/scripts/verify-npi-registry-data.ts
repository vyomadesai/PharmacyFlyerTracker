import { getPool } from '../src/config/db.js';

async function main() {
  const pool = await getPool();
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_NPI_Registry_Data) AS Providers,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress) AS SecondaryAddresses,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy) AS Taxonomies;
  `);
  console.log('Counts:', counts.recordset[0]);

  const specialties = await pool.request().query(`
    SELECT COUNT(*) AS UniquePrimaryTaxonomies
    FROM (
      SELECT DISTINCT
        LTRIM(RTRIM(TaxonomyCode)) AS TaxonomyCode,
        LTRIM(RTRIM(TaxonomyDescription)) AS TaxonomyDescription
      FROM dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy
      WHERE IsPrimary = 1
        AND NULLIF(LTRIM(RTRIM(TaxonomyCode)), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(TaxonomyDescription)), '') IS NOT NULL
    ) t;
  `);
  console.log('Unique primary taxonomies for dropdown:', specialties.recordset[0]);

  for (const npi of ['1265435481', '1417265901']) {
    const provider = await pool.request()
      .input('Npi', npi)
      .query(`
        SELECT TOP 1 *
        FROM dbo.PharmacyFlyer_NPI_Registry_Data
        WHERE Npi = @Npi;
      `);
    const taxonomies = await pool.request()
      .input('Npi', npi)
      .query(`
        SELECT t.*
        FROM dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy t
        JOIN dbo.PharmacyFlyer_NPI_Registry_Data p ON p.RegistryProviderId = t.RegistryProviderId
        WHERE p.Npi = @Npi
        ORDER BY t.SortOrder;
      `);
    console.log(`\nNPI ${npi}:`, provider.recordset[0]);
    console.log('Taxonomies:', taxonomies.recordset);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
