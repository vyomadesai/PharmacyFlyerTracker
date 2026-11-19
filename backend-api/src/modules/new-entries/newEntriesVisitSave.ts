import crypto from 'node:crypto';
import { getPool, sql } from '../../config/db.js';

const ENTRY_TABLE = 'dbo.PharmacyFlyer_APPNewEntries';
const PHOTO_TABLE = 'dbo.PharmacyFlyer_APPNewEntryPhoto';

export type VisitProviderInput = {
  npi: string;
  providerName: string;
  providerAddress: string;
  phone?: string | null;
  taxonomyCode?: string | null;
  taxonomyDesc?: string | null;
  primaryTaxonomy?: string | null;
  selectedTaxonomy?: string | null;
  taxonomyState?: string | null;
  licenseNumber?: string | null;
};

export type SaveOrgVisitInput = {
  staffUserId: number;
  visitBatchId?: string | null;
  practiceName: string;
  locationAddress: string;
  organizationNpi: string;
  organizationName: string;
  organizationAddress: string;
  phone?: string | null;
  taxonomyCode?: string | null;
  taxonomyDesc?: string | null;
  primaryTaxonomy?: string | null;
  selectedTaxonomy?: string | null;
  taxonomyState?: string | null;
  licenseNumber?: string | null;
  campaignId: number;
  flyerTitle?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  providers: VisitProviderInput[];
  photo?: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  } | null;
};

function cleanVisitBatchId(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return crypto.randomUUID();
  return /^[0-9a-f-]{36}$/i.test(text) ? text : crypto.randomUUID();
}

async function insertEntry(
  transaction: InstanceType<typeof sql.Transaction>,
  row: {
    staffUserId: number;
    visitBatchId: string;
    practiceName: string;
    locationAddress: string;
    providerName: string;
    providerAddress: string;
    npiNumber: string | null;
    organizationNpi: string | null;
    isOrgFlyerRow: boolean;
    phone: string | null;
    taxonomyCode: string | null;
    taxonomyDesc: string | null;
    primaryTaxonomy: string | null;
    selectedTaxonomy: string | null;
    taxonomyState: string | null;
    licenseNumber: string | null;
    campaignId: number | null;
    flyerTitle: string | null;
    flyerDropped: boolean;
    latitude: number | null;
    longitude: number | null;
  },
) {
  const insertResult = await new sql.Request(transaction)
    .input('SubmittedByUserId', sql.Int, row.staffUserId)
    .input('VisitBatchId', sql.UniqueIdentifier, row.visitBatchId)
    .input('OrganizationNpi', sql.VarChar, row.organizationNpi)
    .input('IsOrgFlyerRow', sql.Bit, row.isOrgFlyerRow ? 1 : 0)
    .input('PracticeName', sql.NVarChar, row.practiceName)
    .input('LocationAddress', sql.NVarChar, row.locationAddress)
    .input('ProviderName', sql.NVarChar, row.providerName)
    .input('ProviderAddress', sql.NVarChar, row.providerAddress)
    .input('NpiNumber', sql.VarChar, row.npiNumber)
    .input('Phone', sql.VarChar, row.phone)
    .input('TaxonomyCode', sql.VarChar, row.taxonomyCode)
    .input('TaxonomyDesc', sql.NVarChar, row.taxonomyDesc)
    .input('PrimaryTaxonomy', sql.NVarChar, row.primaryTaxonomy)
    .input('SelectedTaxonomy', sql.NVarChar, row.selectedTaxonomy)
    .input('TaxonomyState', sql.VarChar, row.taxonomyState)
    .input('LicenseNumber', sql.NVarChar, row.licenseNumber)
    .input('CampaignId', sql.Int, row.campaignId)
    .input('FlyerTitle', sql.NVarChar, row.flyerTitle)
    .input('FlyerDropped', sql.Bit, row.flyerDropped ? 1 : 0)
    .input('Latitude', sql.Decimal(10, 7), row.latitude)
    .input('Longitude', sql.Decimal(10, 7), row.longitude)
    .query(`
      INSERT INTO ${ENTRY_TABLE} (
        SubmittedByUserId, VisitBatchId, OrganizationNpi, IsOrgFlyerRow,
        PracticeName, LocationAddress, ProviderName, ProviderAddress,
        NpiNumber, Phone, TaxonomyCode, TaxonomyDesc, PrimaryTaxonomy, SelectedTaxonomy,
        TaxonomyState, LicenseNumber, CampaignId, FlyerTitle, FlyerDropped,
        Latitude, Longitude, Status
      )
      OUTPUT INSERTED.AppNewEntryId, INSERTED.SubmittedAt
      VALUES (
        @SubmittedByUserId, @VisitBatchId, @OrganizationNpi, @IsOrgFlyerRow,
        @PracticeName, @LocationAddress, @ProviderName, @ProviderAddress,
        @NpiNumber, @Phone, @TaxonomyCode, @TaxonomyDesc, @PrimaryTaxonomy, @SelectedTaxonomy,
        @TaxonomyState, @LicenseNumber, @CampaignId, @FlyerTitle, @FlyerDropped,
        @Latitude, @Longitude, 'pending'
      )
    `);

  return insertResult.recordset[0] as { AppNewEntryId: number | bigint; SubmittedAt: Date | string };
}

export async function saveOrgVisitBatch(input: SaveOrgVisitInput) {
  const visitBatchId = cleanVisitBatchId(input.visitBatchId);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    const orgRow = await insertEntry(transaction, {
      staffUserId: input.staffUserId,
      visitBatchId,
      practiceName: input.practiceName,
      locationAddress: input.locationAddress,
      providerName: input.organizationName,
      providerAddress: input.organizationAddress,
      npiNumber: input.organizationNpi,
      organizationNpi: input.organizationNpi,
      isOrgFlyerRow: true,
      phone: input.phone || null,
      taxonomyCode: input.taxonomyCode || null,
      taxonomyDesc: input.taxonomyDesc || null,
      primaryTaxonomy: input.primaryTaxonomy || null,
      selectedTaxonomy: input.selectedTaxonomy || null,
      taxonomyState: input.taxonomyState || null,
      licenseNumber: input.licenseNumber || null,
      campaignId: input.campaignId,
      flyerTitle: input.flyerTitle || null,
      flyerDropped: true,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });

    const orgEntryId = Number(orgRow.AppNewEntryId);

    if (input.photo?.buffer?.length) {
      await new sql.Request(transaction)
        .input('AppNewEntryId', sql.BigInt, orgEntryId)
        .input('FileName', sql.NVarChar, input.photo.originalname)
        .input('ContentType', sql.NVarChar, input.photo.mimetype)
        .input('FileSizeBytes', sql.BigInt, input.photo.size)
        .input('PhotoData', sql.VarBinary(sql.MAX), input.photo.buffer)
        .query(`
          INSERT INTO ${PHOTO_TABLE} (
            AppNewEntryId, FileName, ContentType, FileSizeBytes, PhotoData
          )
          VALUES (
            @AppNewEntryId, @FileName, @ContentType, @FileSizeBytes, @PhotoData
          )
        `);
    }

    const providerEntryIds: number[] = [];
    for (const provider of input.providers) {
      const row = await insertEntry(transaction, {
        staffUserId: input.staffUserId,
        visitBatchId,
        practiceName: input.practiceName,
        locationAddress: input.locationAddress,
        providerName: provider.providerName,
        providerAddress: provider.providerAddress,
        npiNumber: provider.npi.replace(/\D/g, '').slice(0, 10) || null,
        organizationNpi: input.organizationNpi,
        isOrgFlyerRow: false,
        phone: provider.phone || input.phone || null,
        taxonomyCode: provider.taxonomyCode || null,
        taxonomyDesc: provider.taxonomyDesc || null,
        primaryTaxonomy: provider.primaryTaxonomy || null,
        selectedTaxonomy: provider.selectedTaxonomy || null,
        taxonomyState: provider.taxonomyState || null,
        licenseNumber: provider.licenseNumber || null,
        campaignId: null,
        flyerTitle: null,
        flyerDropped: false,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      });
      providerEntryIds.push(Number(row.AppNewEntryId));
    }

    await transaction.commit();

    return {
      visitBatchId,
      orgEntryId,
      providerEntryIds,
      providerCount: providerEntryIds.length,
      submittedAt: orgRow.SubmittedAt instanceof Date
        ? orgRow.SubmittedAt.toISOString()
        : String(orgRow.SubmittedAt),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
