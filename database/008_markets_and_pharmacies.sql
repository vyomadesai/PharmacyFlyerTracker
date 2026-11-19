/*
  Active market/location and pharmacy flyer targets.

  Legacy DB inspection notes:
    - dbo.Master_PharmacyInformation exists (name/address/phone/fax) but has no MarketId,
      no lat/lng, and serves legacy Rx pharmacy master data — not reused as flyer target table.
    - No market, territory, or facility table suitable for flyer geography was found.
    - dbo.Master_Location is practice-location data tied to Practice_Id, not pharmacies.

  New tables:
    dbo.PharmacyFlyer_Market
    dbo.PharmacyFlyer_Pharmacy
*/

IF OBJECT_ID('dbo.PharmacyFlyer_Market', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_Market (
    MarketId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_Market PRIMARY KEY,
    MarketName NVARCHAR(200) NOT NULL,
    MarketNumber NVARCHAR(50) NOT NULL,
    CenterAddress NVARCHAR(300) NULL,
    CenterCity NVARCHAR(100) NULL,
    CenterState NVARCHAR(50) NULL,
    CenterZip NVARCHAR(20) NULL,
    CenterLatitude DECIMAL(10, 7) NULL,
    CenterLongitude DECIMAL(10, 7) NULL,
    RadiusMiles DECIMAL(8, 2) NOT NULL CONSTRAINT DF_PharmacyFlyer_Market_RadiusMiles DEFAULT 10,
    IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_Market_IsActive DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Market_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_PharmacyFlyer_Market_MarketNumber UNIQUE (MarketNumber)
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_Pharmacy', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_Pharmacy (
    PharmacyId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_Pharmacy PRIMARY KEY,
    PharmacyName NVARCHAR(200) NOT NULL,
    Address1 NVARCHAR(300) NULL,
    Address2 NVARCHAR(300) NULL,
    City NVARCHAR(100) NULL,
    State NVARCHAR(50) NULL,
    Zip NVARCHAR(20) NULL,
    Phone NVARCHAR(30) NULL,
    Fax NVARCHAR(30) NULL,
    Latitude DECIMAL(10, 7) NULL,
    Longitude DECIMAL(10, 7) NULL,
    MarketId INT NULL,
    LegacyPharmacyInfoNo INT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_Pharmacy_IsActive DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Pharmacy_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_Pharmacy_Market
      FOREIGN KEY (MarketId) REFERENCES dbo.PharmacyFlyer_Market(MarketId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_Pharmacy_Market_IsActive'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Pharmacy')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_Pharmacy_Market_IsActive
  ON dbo.PharmacyFlyer_Pharmacy (MarketId, IsActive, PharmacyName);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_Market_IsActive'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_Market')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_Market_IsActive
  ON dbo.PharmacyFlyer_Market (IsActive, MarketName);
END;
GO

-- Optional sample market (safe to re-run).
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
