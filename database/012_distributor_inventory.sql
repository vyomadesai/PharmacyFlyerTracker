/*
  Distributor flyer inventory and assignment batches.
*/

IF OBJECT_ID('dbo.PharmacyFlyer_DistributorAssignmentBatch', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_DistributorAssignmentBatch (
    AssignmentBatchId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_DistributorAssignmentBatch PRIMARY KEY,
    BatchName NVARCHAR(200) NOT NULL,
    DistributorUserId INT NOT NULL,
    AssignmentDate DATE NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorAssignmentBatch_AssignmentDate DEFAULT (CAST(SYSDATETIME() AS DATE)),
    MarketId INT NULL,
    TotalStops INT NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorAssignmentBatch_TotalStops DEFAULT 0,
    TotalFlyers INT NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorAssignmentBatch_TotalFlyers DEFAULT 0,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorAssignmentBatch_Status DEFAULT 'assigned',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorAssignmentBatch_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_DistributorAssignmentBatch_Market
      FOREIGN KEY (MarketId) REFERENCES dbo.PharmacyFlyer_Market(MarketId),
    CONSTRAINT CK_PharmacyFlyer_DistributorAssignmentBatch_Status
      CHECK (Status IN ('draft', 'assigned', 'in_progress', 'completed', 'cancelled'))
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_DistributorInventory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_DistributorInventory (
    DistributorInventoryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_DistributorInventory PRIMARY KEY,
    DistributorUserId INT NOT NULL,
    CampaignId INT NOT NULL,
    AssignmentBatchId INT NULL,
    FlyerName NVARCHAR(200) NULL,
    AssignedQuantity INT NOT NULL,
    DeliveredQuantity INT NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorInventory_DeliveredQuantity DEFAULT 0,
    RemainingQuantity AS (AssignedQuantity - DeliveredQuantity) PERSISTED,
    AssignmentDate DATE NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorInventory_AssignmentDate DEFAULT (CAST(SYSDATETIME() AS DATE)),
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorInventory_Status DEFAULT 'assigned',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorInventory_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_PharmacyFlyer_DistributorInventory_Campaign
      FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
    CONSTRAINT FK_PharmacyFlyer_DistributorInventory_Batch
      FOREIGN KEY (AssignmentBatchId) REFERENCES dbo.PharmacyFlyer_DistributorAssignmentBatch(AssignmentBatchId),
    CONSTRAINT CK_PharmacyFlyer_DistributorInventory_AssignedQuantity CHECK (AssignedQuantity >= 0),
    CONSTRAINT CK_PharmacyFlyer_DistributorInventory_DeliveredQuantity CHECK (DeliveredQuantity >= 0),
    CONSTRAINT CK_PharmacyFlyer_DistributorInventory_Status
      CHECK (Status IN ('assigned', 'in_progress', 'completed', 'cancelled'))
  );
END;
GO

IF OBJECT_ID('dbo.PharmacyFlyer_DistributorBatchStop', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PharmacyFlyer_DistributorBatchStop (
    BatchStopId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PharmacyFlyer_DistributorBatchStop PRIMARY KEY,
    AssignmentBatchId INT NOT NULL,
    CampaignTargetId INT NULL,
    StopLabel NVARCHAR(200) NULL,
    AddressLine NVARCHAR(500) NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorBatchStop_SortOrder DEFAULT 0,
    FlyersForStop INT NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorBatchStop_FlyersForStop DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_DistributorBatchStop_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_PharmacyFlyer_DistributorBatchStop_Batch
      FOREIGN KEY (AssignmentBatchId) REFERENCES dbo.PharmacyFlyer_DistributorAssignmentBatch(AssignmentBatchId),
    CONSTRAINT FK_PharmacyFlyer_DistributorBatchStop_Target
      FOREIGN KEY (CampaignTargetId) REFERENCES dbo.PharmacyFlyer_CampaignTarget(CampaignTargetId)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_DistributorInventory_DistributorUserId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_DistributorInventory')
)
  CREATE INDEX IX_PharmacyFlyer_DistributorInventory_DistributorUserId
  ON dbo.PharmacyFlyer_DistributorInventory (DistributorUserId, AssignmentDate, Status);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_DistributorInventory_CampaignId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_DistributorInventory')
)
  CREATE INDEX IX_PharmacyFlyer_DistributorInventory_CampaignId
  ON dbo.PharmacyFlyer_DistributorInventory (CampaignId, AssignmentDate);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_DistributorAssignmentBatch_DistributorUserId'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_DistributorAssignmentBatch')
)
  CREATE INDEX IX_PharmacyFlyer_DistributorAssignmentBatch_DistributorUserId
  ON dbo.PharmacyFlyer_DistributorAssignmentBatch (DistributorUserId, AssignmentDate, Status);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_PharmacyFlyer_DistributorBatchStop_Batch'
    AND object_id = OBJECT_ID('dbo.PharmacyFlyer_DistributorBatchStop')
)
  CREATE INDEX IX_PharmacyFlyer_DistributorBatchStop_Batch
  ON dbo.PharmacyFlyer_DistributorBatchStop (AssignmentBatchId, SortOrder);
GO
