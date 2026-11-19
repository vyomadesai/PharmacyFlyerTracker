/*
  Extend PharmacyFlyer_CampaignTarget for doctor/pharmacy approval workflow.
  Safe to re-run: adds columns/indexes only when missing.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_CampaignTarget (
    CampaignTargetId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_CampaignTarget PRIMARY KEY,
    CampaignId INT NOT NULL,
    CampaignConfigId INT NULL,
    TargetType VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_TargetType DEFAULT 'doctor',
    DoctorId INT NULL,
    NPI VARCHAR(10) NULL,
    PharmacyId INT NULL,
    AssignedFlyerName NVARCHAR(200) NULL,
    ApprovalStatus VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_ApprovalStatus DEFAULT 'suggested',
    ApprovedByUserId INT NULL,
    ApprovedAt DATETIME2 NULL,
    RejectedByUserId INT NULL,
    RejectedAt DATETIME2 NULL,
    ApprovalNotes NVARCHAR(1000) NULL,
    VisitFrequencyType VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_VisitFrequencyType DEFAULT 'one_time',
    VisitFrequencyDays INT NULL,
    NextDueDate DATE NULL,
    LastVisitedAt DATETIME2 NULL,
    CheckInRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_CheckInRequired DEFAULT 1,
    ProofUploadRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_ProofUploadRequired DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_CampaignTarget_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_CampaignTarget_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
    CONSTRAINT FK_PharmacyFlyer_CampaignTarget_Config
      FOREIGN KEY (CampaignConfigId) REFERENCES dbo.PharmacyFlyer_CampaignConfig(CampaignConfigId),
    CONSTRAINT FK_PharmacyFlyer_CampaignTarget_Pharmacy
      FOREIGN KEY (PharmacyId) REFERENCES dbo.PharmacyFlyer_Pharmacy(PharmacyId),
    CONSTRAINT CK_PharmacyFlyer_CampaignTarget_TargetType
      CHECK (TargetType IN ('doctor', 'pharmacy')),
    CONSTRAINT CK_PharmacyFlyer_CampaignTarget_ApprovalStatus
      CHECK (ApprovalStatus IN ('suggested', 'approved', 'rejected', 'assigned', 'completed', 'skipped'))
  );
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'TargetType') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD TargetType VARCHAR(20) NOT NULL
    CONSTRAINT DF_PharmacyFlyer_CampaignTarget_TargetType DEFAULT 'doctor' WITH VALUES;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'PharmacyId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD PharmacyId INT NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'AssignedFlyerName') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD AssignedFlyerName NVARCHAR(200) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'ApprovalStatus') IS NULL
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD ApprovalStatus VARCHAR(20) NULL;
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'ApprovalStatus') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'TargetStatus') IS NOT NULL
  BEGIN
    UPDATE dbo.PharmacyFlyer_CampaignTarget
    SET ApprovalStatus = TargetStatus
    WHERE ApprovalStatus IS NULL;
  END;

  UPDATE dbo.PharmacyFlyer_CampaignTarget
  SET ApprovalStatus = 'suggested'
  WHERE ApprovalStatus IS NULL;

  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ALTER COLUMN ApprovalStatus VARCHAR(20) NOT NULL;
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'ApprovedByUserId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD ApprovedByUserId INT NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'ApprovedAt') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD ApprovedAt DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'RejectedByUserId') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD RejectedByUserId INT NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'RejectedAt') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD RejectedAt DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'ApprovalNotes') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD ApprovalNotes NVARCHAR(1000) NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'VisitFrequencyType') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD VisitFrequencyType VARCHAR(20) NOT NULL
    CONSTRAINT DF_PharmacyFlyer_CampaignTarget_VisitFrequencyType DEFAULT 'one_time' WITH VALUES;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'VisitFrequencyDays') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD VisitFrequencyDays INT NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'NextDueDate') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD NextDueDate DATE NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'LastVisitedAt') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD LastVisitedAt DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'CheckInRequired') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD CheckInRequired BIT NOT NULL
    CONSTRAINT DF_PharmacyFlyer_CampaignTarget_CheckInRequired DEFAULT 1 WITH VALUES;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'ProofUploadRequired') IS NULL
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ADD ProofUploadRequired BIT NOT NULL
    CONSTRAINT DF_PharmacyFlyer_CampaignTarget_ProofUploadRequired DEFAULT 1 WITH VALUES;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'DoctorId') IS NOT NULL
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget ALTER COLUMN DoctorId INT NULL;
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'TargetType') IS NOT NULL
BEGIN
  UPDATE dbo.PharmacyFlyer_CampaignTarget
  SET TargetType = 'doctor'
  WHERE TargetType IS NULL OR LTRIM(RTRIM(TargetType)) = '';
END;
GO

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UQ_PharmacyFlyer_CampaignTarget_Config_Doctor'
    AND parent_object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget DROP CONSTRAINT UQ_PharmacyFlyer_CampaignTarget_Config_Doctor;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_CampaignConfigId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_CampaignConfigId
  ON dbo.PharmacyFlyer_CampaignTarget (CampaignConfigId, ApprovalStatus);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_TargetType'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_TargetType
  ON dbo.PharmacyFlyer_CampaignTarget (TargetType, ApprovalStatus);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_NPI'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_NPI
  ON dbo.PharmacyFlyer_CampaignTarget (NPI, ApprovalStatus);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_PharmacyId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_PharmacyId
  ON dbo.PharmacyFlyer_CampaignTarget (PharmacyId, ApprovalStatus);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_ApprovalStatus'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_ApprovalStatus
  ON dbo.PharmacyFlyer_CampaignTarget (ApprovalStatus, CampaignId);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_PharmacyFlyer_CampaignTarget_NextDueDate'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE INDEX IX_PharmacyFlyer_CampaignTarget_NextDueDate
  ON dbo.PharmacyFlyer_CampaignTarget (NextDueDate, ApprovalStatus);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_PharmacyFlyer_CampaignTarget_Config_DoctorNPI'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE UNIQUE INDEX UQ_PharmacyFlyer_CampaignTarget_Config_DoctorNPI
  ON dbo.PharmacyFlyer_CampaignTarget (CampaignConfigId, NPI)
  WHERE TargetType = 'doctor' AND NPI IS NOT NULL;
END;
GO

IF COL_LENGTH('dbo.PharmacyFlyer_CampaignTarget', 'NPI') IS NOT NULL
BEGIN
  UPDATE dbo.PharmacyFlyer_CampaignTarget SET NPI = NULL WHERE LTRIM(RTRIM(ISNULL(NPI, ''))) = '';
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_PharmacyFlyer_CampaignTarget_Config_DoctorNoNPI'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE UNIQUE INDEX UQ_PharmacyFlyer_CampaignTarget_Config_DoctorNoNPI
  ON dbo.PharmacyFlyer_CampaignTarget (CampaignConfigId, DoctorId)
  WHERE TargetType = 'doctor' AND NPI IS NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_PharmacyFlyer_CampaignTarget_Config_Pharmacy'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_CampaignTarget')
)
BEGIN
  CREATE UNIQUE INDEX UQ_PharmacyFlyer_CampaignTarget_Config_Pharmacy
  ON dbo.PharmacyFlyer_CampaignTarget (CampaignConfigId, PharmacyId)
  WHERE TargetType = 'pharmacy' AND PharmacyId IS NOT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_PharmacyFlyer_CampaignTarget_Pharmacy'
)
BEGIN
  ALTER TABLE dbo.PharmacyFlyer_CampaignTarget
  ADD CONSTRAINT FK_PharmacyFlyer_CampaignTarget_Pharmacy
    FOREIGN KEY (PharmacyId) REFERENCES dbo.PharmacyFlyer_Pharmacy(PharmacyId);
END;
GO
