/*
  Role-based access control profiles for Pharmacy Flyer Tracker.

  Master_User has no usable role column (verified columns: ID, User_Id, names,
  password, email, phone, address fields, User_IsActive, audit columns).

  This script creates dbo.PharmacyFlyer_UserProfile linked to Master_User.ID.
  Does not alter dbo.Master_User.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_UserProfile', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_UserProfile (
    UserProfileId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_UserProfile PRIMARY KEY,
    UserId INT NOT NULL,
    Role VARCHAR(20) NOT NULL,
    EmploymentType VARCHAR(20) NULL,
    HomeAddress NVARCHAR(500) NULL,
    HomeLatitude DECIMAL(10, 7) NULL,
    HomeLongitude DECIMAL(10, 7) NULL,
    DefaultDailyFlyerCapacity INT NOT NULL CONSTRAINT DF_PharmacyFlyer_UserProfile_DefaultDailyFlyerCapacity DEFAULT 25,
    IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_UserProfile_IsActive DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_UserProfile_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_PharmacyFlyer_UserProfile_UserId UNIQUE (UserId),
    CONSTRAINT CK_PharmacyFlyer_UserProfile_Role CHECK (Role IN ('admin', 'manager', 'distributor')),
    CONSTRAINT CK_PharmacyFlyer_UserProfile_EmploymentType CHECK (
      EmploymentType IS NULL OR EmploymentType IN ('part_time', 'full_time')
    )
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_UserProfile_Role_IsActive'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_UserProfile')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_UserProfile_Role_IsActive
  ON dbo.PharmacyFlyer_UserProfile (Role, IsActive);
END;
GO

-- Seed test users from 003_fix_login_test_users.sql when they exist.
MERGE dbo.PharmacyFlyer_UserProfile AS target
USING (
  SELECT u.ID AS UserId, 'distributor' AS Role, 'full_time' AS EmploymentType
  FROM dbo.Master_User u
  WHERE LOWER(LTRIM(RTRIM(ISNULL(u.User_Id, '')))) = 'flyer'
     OR LOWER(LTRIM(RTRIM(ISNULL(u.User_Email, '')))) = 'flyer'

  UNION ALL

  SELECT u.ID AS UserId, 'admin' AS Role, NULL AS EmploymentType
  FROM dbo.Master_User u
  WHERE LOWER(LTRIM(RTRIM(ISNULL(u.User_Id, '')))) = 'vishal'
     OR LOWER(LTRIM(RTRIM(ISNULL(u.User_Email, '')))) = 'vishalmalkan@gmail.com'
) AS source
ON target.UserId = source.UserId
WHEN MATCHED THEN
  UPDATE SET
    Role = source.Role,
    EmploymentType = source.EmploymentType,
    DefaultDailyFlyerCapacity = 25,
    IsActive = 1,
    UpdatedAt = SYSDATETIME()
WHEN NOT MATCHED BY TARGET THEN
  INSERT (UserId, Role, EmploymentType, DefaultDailyFlyerCapacity, IsActive)
  VALUES (source.UserId, source.Role, source.EmploymentType, 25, 1);
GO
