/*
  Demo-only Pinellas/St. Petersburg scenario seed (safe to re-run).
  Does NOT modify production Master_Doctor data.
  Run manually in dev/test, or via: DEMO_SEED=1 npm run seed:demo

  Creates:
    - Pinellas/St. Petersburg market (PIN-STP-001)
    - Demo pharmacies 1–4 near Pinellas Park / St. Petersburg
*/
IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_Market WHERE MarketNumber = 'PIN-STP-001')
BEGIN
  INSERT INTO dbo.PharmacyFlyer_Market (
    MarketName, MarketNumber, CenterAddress, CenterCity, CenterState, CenterZip,
    CenterLatitude, CenterLongitude, RadiusMiles, IsActive
  )
  VALUES (
    'Pinellas / St. Petersburg Area', 'PIN-STP-001', '5000 Park Blvd', 'Pinellas Park', 'FL', '33781',
    27.8428, -82.6995, 15, 1
  );
END;
GO

DECLARE @MarketId INT = (SELECT TOP 1 MarketId FROM dbo.PharmacyFlyer_Market WHERE MarketNumber = 'PIN-STP-001');

IF @MarketId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.PharmacyFlyer_Pharmacy WHERE PharmacyName = 'Demo Pharmacy 1 [DEV]'
)
BEGIN
  INSERT INTO dbo.PharmacyFlyer_Pharmacy (
    PharmacyName, Address1, City, State, Zip, Phone, Latitude, Longitude, MarketId, IsActive
  )
  VALUES
    ('Demo Pharmacy 1 [DEV]', '5000 Park Blvd', 'Pinellas Park', 'FL', '33781', '727-555-0101', 27.8428, -82.6995, @MarketId, 1),
    ('Demo Pharmacy 2 [DEV]', '2200 Central Ave', 'St Petersburg', 'FL', '33713', '727-555-0102', 27.7910, -82.6794, @MarketId, 1),
    ('Demo Pharmacy 3 [DEV]', '1500 4th St N', 'St Petersburg', 'FL', '33704', '727-555-0103', 27.7731, -82.6400, @MarketId, 1),
    ('Demo Pharmacy 4 [DEV]', '3301 5th Ave N', 'St Petersburg', 'FL', '33713', '727-555-0104', 27.7770, -82.6800, @MarketId, 1);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM dbo.PharmacyFlyer_Campaign WHERE CampaignName = 'Demo Pinellas/St. Petersburg Flyer Campaign [DEV]'
)
BEGIN
  INSERT INTO dbo.PharmacyFlyer_Campaign (
    CampaignName, Description, StartDate, EndDate, IsActive, CreatedBy
  )
  VALUES (
    'Demo Pinellas/St. Petersburg Flyer Campaign [DEV]',
    'Development demo campaign for assigned route workflow. Safe to delete in production.',
    CAST(GETDATE() AS DATE),
    DATEADD(day, 90, CAST(GETDATE() AS DATE)),
    1,
    NULL
  );
END;
GO
