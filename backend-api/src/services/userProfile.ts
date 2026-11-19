import { getPool, sql } from '../config/db.js';

export type AppRole = 'admin' | 'manager' | 'distributor';
export type EmploymentType = 'part_time' | 'full_time';
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

export type UserProfile = {
  userProfileId: number;
  userId: number;
  role: AppRole;
  employmentType: EmploymentType | null;
  homeAddress: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  defaultDailyFlyerCapacity: number;
  isActive: boolean;
};

const VALID_ROLES = new Set<AppRole>(['admin', 'manager', 'distributor']);

function mapRow(row: Record<string, unknown>): UserProfile {
  return {
    userProfileId: Number(row.UserProfileId),
    userId: Number(row.UserId),
    role: String(row.Role) as AppRole,
    employmentType: row.EmploymentType ? (String(row.EmploymentType) as EmploymentType) : null,
    homeAddress: row.HomeAddress ? String(row.HomeAddress) : null,
    homeLatitude: row.HomeLatitude != null ? Number(row.HomeLatitude) : null,
    homeLongitude: row.HomeLongitude != null ? Number(row.HomeLongitude) : null,
    defaultDailyFlyerCapacity: Number(row.DefaultDailyFlyerCapacity ?? 25),
    isActive: Boolean(row.IsActive),
  };
}

export async function ensureProfileTable() {
  const pool = await getPool();
  await pool.request().query(`
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
  `);
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT TOP 1
        UserProfileId,
        UserId,
        Role,
        EmploymentType,
        HomeAddress,
        HomeLatitude,
        HomeLongitude,
        DefaultDailyFlyerCapacity,
        IsActive
      FROM dbo.PharmacyFlyer_UserProfile
      WHERE UserId = @UserId
        AND IsActive = 1
    `);

  const row = result.recordset[0];
  if (!row) return null;

  const profile = mapRow(row);
  return VALID_ROLES.has(profile.role) ? profile : null;
}

/** Auto-provision distributor profile so legacy field users keep working after RBAC rollout. */
export async function ensureDefaultDistributorProfile(userId: number): Promise<UserProfile> {
  const existing = await getUserProfile(userId);
  if (existing) return existing;

  await ensureProfileTable();
  const pool = await getPool();
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_UserProfile WHERE UserId = @UserId)
      BEGIN
        INSERT INTO dbo.PharmacyFlyer_UserProfile (UserId, Role, EmploymentType, DefaultDailyFlyerCapacity, IsActive)
        VALUES (@UserId, 'distributor', 'full_time', 25, 1);
      END;

      SELECT TOP 1
        UserProfileId,
        UserId,
        Role,
        EmploymentType,
        HomeAddress,
        HomeLatitude,
        HomeLongitude,
        DefaultDailyFlyerCapacity,
        IsActive
      FROM dbo.PharmacyFlyer_UserProfile
      WHERE UserId = @UserId AND IsActive = 1;
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new Error(`Could not load or create profile for user ${userId}`);
  }

  console.warn(`Auto-created distributor profile for Master_User.ID=${userId}`);
  return mapRow(row);
}

export function profileToResponse(profile: UserProfile) {
  return {
    userProfileId: profile.userProfileId,
    role: profile.role,
    employmentType: profile.employmentType,
    homeAddress: profile.homeAddress,
    homeLatitude: profile.homeLatitude,
    homeLongitude: profile.homeLongitude,
    defaultDailyFlyerCapacity: profile.defaultDailyFlyerCapacity,
    isActive: profile.isActive,
  };
}

export type DistributorListRow = {
  userId: number;
  userCode: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: AppRole;
  employmentType: EmploymentType | null;
  homeAddress: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  defaultDailyFlyerCapacity: number;
  isActive: boolean;
  assignedToday: number;
  deliveredToday: number;
  remainingToday: number;
};

function mapDistributorRow(row: Record<string, unknown>): DistributorListRow {
  const firstName = row.User_FirstName ? String(row.User_FirstName) : null;
  const lastName = row.User_LastName ? String(row.User_LastName) : null;
  return {
    userId: Number(row.ID),
    userCode: row.User_Id ? String(row.User_Id) : null,
    firstName,
    lastName,
    fullName: `${firstName || ''} ${lastName || ''}`.trim() || String(row.User_Id || row.ID),
    email: row.User_Email ? String(row.User_Email) : null,
    phone: row.User_Phone ? String(row.User_Phone) : null,
    role: String(row.Role) as AppRole,
    employmentType: row.EmploymentType ? (String(row.EmploymentType) as EmploymentType) : null,
    homeAddress: row.HomeAddress ? String(row.HomeAddress) : null,
    homeLatitude: row.HomeLatitude != null ? Number(row.HomeLatitude) : null,
    homeLongitude: row.HomeLongitude != null ? Number(row.HomeLongitude) : null,
    defaultDailyFlyerCapacity: Number(row.DefaultDailyFlyerCapacity ?? 25),
    isActive: Boolean(row.IsActive),
    assignedToday: Number(row.AssignedToday ?? 0),
    deliveredToday: Number(row.DeliveredToday ?? 0),
    remainingToday: Number(row.RemainingToday ?? 0),
  };
}

export async function listDistributors(includeInactive = false) {
  await ensureProfileTable();
  const pool = await getPool();
  const result = await pool.request()
    .input('IncludeInactive', sql.Bit, includeInactive ? 1 : 0)
    .query(`
      SELECT
        u.ID,
        u.User_Id,
        u.User_FirstName,
        u.User_LastName,
        u.User_Email,
        u.User_Phone,
        p.Role,
        p.EmploymentType,
        p.HomeAddress,
        p.HomeLatitude,
        p.HomeLongitude,
        p.DefaultDailyFlyerCapacity,
        p.IsActive,
        ISNULL(inv.AssignedToday, 0) AS AssignedToday,
        ISNULL(inv.DeliveredToday, 0) AS DeliveredToday,
        ISNULL(inv.RemainingToday, 0) AS RemainingToday
      FROM dbo.Master_User u WITH (NOLOCK)
      INNER JOIN dbo.PharmacyFlyer_UserProfile p ON p.UserId = u.ID
      LEFT JOIN (
        SELECT
          DistributorUserId,
          SUM(AssignedQuantity) AS AssignedToday,
          SUM(DeliveredQuantity) AS DeliveredToday,
          SUM(RemainingQuantity) AS RemainingToday
        FROM dbo.PharmacyFlyer_DistributorInventory
        WHERE AssignmentDate = ${FLORIDA_SQL_TODAY}
          AND Status <> 'cancelled'
        GROUP BY DistributorUserId
      ) inv ON inv.DistributorUserId = u.ID
      WHERE p.Role = 'distributor'
        AND (@IncludeInactive = 1 OR p.IsActive = 1)
      ORDER BY u.User_FirstName, u.User_LastName, u.User_Id
    `);

  return result.recordset.map((row: Record<string, unknown>) => mapDistributorRow(row));
}

export async function upsertUserProfile(input: {
  userId: number;
  role?: AppRole;
  employmentType?: EmploymentType | null;
  homeAddress?: string | null;
  homeLatitude?: number | null;
  homeLongitude?: number | null;
  defaultDailyFlyerCapacity?: number;
  isActive?: boolean;
}) {
  await ensureProfileTable();
  const pool = await getPool();

  const userExists = await pool.request()
    .input('UserId', sql.Int, input.userId)
    .query(`SELECT TOP 1 ID FROM dbo.Master_User WHERE ID = @UserId`);
  if (!userExists.recordset[0]) throw new Error('User not found');

  const existing = await pool.request()
    .input('UserId', sql.Int, input.userId)
    .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_UserProfile WHERE UserId = @UserId`);

  const current = existing.recordset[0];
  const role = input.role ?? (current ? String(current.Role) : 'distributor');
  const employmentType = input.employmentType !== undefined
    ? input.employmentType
    : (current?.EmploymentType ? String(current.EmploymentType) : 'full_time');
  const homeAddress = input.homeAddress !== undefined ? input.homeAddress : (current?.HomeAddress ?? null);
  const homeLatitude = input.homeLatitude !== undefined ? input.homeLatitude : (current?.HomeLatitude ?? null);
  const homeLongitude = input.homeLongitude !== undefined ? input.homeLongitude : (current?.HomeLongitude ?? null);
  const capacity = input.defaultDailyFlyerCapacity ?? Number(current?.DefaultDailyFlyerCapacity ?? 25);
  const isActive = input.isActive ?? Boolean(current?.IsActive ?? true);

  if (!VALID_ROLES.has(role as AppRole)) throw new Error('Invalid role');

  await pool.request()
    .input('UserId', sql.Int, input.userId)
    .input('Role', sql.VarChar, role)
    .input('EmploymentType', sql.VarChar, employmentType)
    .input('HomeAddress', sql.NVarChar, homeAddress)
    .input('HomeLatitude', sql.Decimal(10, 7), homeLatitude)
    .input('HomeLongitude', sql.Decimal(10, 7), homeLongitude)
    .input('DefaultDailyFlyerCapacity', sql.Int, capacity)
    .input('IsActive', sql.Bit, isActive)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_UserProfile WHERE UserId = @UserId)
      BEGIN
        UPDATE dbo.PharmacyFlyer_UserProfile
        SET
          Role = @Role,
          EmploymentType = @EmploymentType,
          HomeAddress = @HomeAddress,
          HomeLatitude = @HomeLatitude,
          HomeLongitude = @HomeLongitude,
          DefaultDailyFlyerCapacity = @DefaultDailyFlyerCapacity,
          IsActive = @IsActive,
          UpdatedAt = SYSDATETIME()
        WHERE UserId = @UserId
      END
      ELSE
      BEGIN
        INSERT INTO dbo.PharmacyFlyer_UserProfile (
          UserId, Role, EmploymentType, HomeAddress, HomeLatitude, HomeLongitude,
          DefaultDailyFlyerCapacity, IsActive
        )
        VALUES (
          @UserId, @Role, @EmploymentType, @HomeAddress, @HomeLatitude, @HomeLongitude,
          @DefaultDailyFlyerCapacity, @IsActive
        )
      END
    `);

  const saved = await pool.request()
    .input('UserId', sql.Int, input.userId)
    .query(`
      SELECT TOP 1
        UserProfileId, UserId, Role, EmploymentType, HomeAddress, HomeLatitude, HomeLongitude,
        DefaultDailyFlyerCapacity, IsActive
      FROM dbo.PharmacyFlyer_UserProfile
      WHERE UserId = @UserId
    `);

  const row = saved.recordset[0];
  return row ? mapRow(row) : null;
}

export async function searchUsersForDistributor(q: string) {
  const pool = await getPool();
  const like = `%${q}%`;
  const result = await pool.request()
    .input('Like', sql.NVarChar, like)
    .query(`
      SELECT TOP 20
        u.ID,
        u.User_Id,
        u.User_FirstName,
        u.User_LastName,
        u.User_Email,
        p.Role,
        p.IsActive
      FROM dbo.Master_User u WITH (NOLOCK)
      LEFT JOIN dbo.PharmacyFlyer_UserProfile p ON p.UserId = u.ID
      WHERE LTRIM(RTRIM(ISNULL(u.User_IsActive, ' '))) <> 'N'
        AND (
          u.User_Id LIKE @Like OR u.User_FirstName LIKE @Like OR u.User_LastName LIKE @Like
          OR u.User_Email LIKE @Like OR u.User_Phone LIKE @Like
        )
      ORDER BY u.User_FirstName, u.User_LastName
    `);
  return result.recordset;
}
