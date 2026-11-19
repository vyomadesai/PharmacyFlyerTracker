import crypto from 'node:crypto';
import { getPool, sql } from '../../config/db.js';
import { parseStreetWithSuite } from '../../utils/streetAddressMatch.js';

const ENTRY_TABLE = 'dbo.PharmacyFlyer_APPNewEntries';
const PHOTO_TABLE = 'dbo.PharmacyFlyer_APPNewEntryPhoto';
const PHYSICAL_STOP_TABLE = 'dbo.PharmacyFlyer_APPPhysicalStops';
const ORG_LINK_TABLE = 'dbo.PharmacyFlyer_APPVisitOrgLinks';

export type PhysicalDropInput = {
  dropStatus: string;
  stopType?: string | null;
  campaignId?: number | null;
  flyerTitle?: string | null;
  flyerQuantity?: number;
  notes?: string | null;
  droppedAt?: string | null;
};

export type OrgLinkInput = {
  organizationNpi: string;
  organizationName: string;
  organizationAddress?: string | null;
  taxonomyCode?: string | null;
  taxonomyDescription?: string | null;
  distanceMiles?: number | null;
  suiteLabel?: string | null;
  verificationStatus?: string | null;
  flyerAttributed?: boolean;
};

export type ProviderCandidateInput = {
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
  verificationStatus?: string | null;
  selectedForReview?: boolean;
};

export type SavePhysicalVisitInput = {
  staffUserId: number;
  visitBatchId?: string | null;
  practiceName: string;
  locationAddress: string;
  street?: string | null;
  suite?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  physicalDrop: PhysicalDropInput;
  orgLinks: OrgLinkInput[];
  providers: ProviderCandidateInput[];
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

function isDroppedStatus(dropStatus: string) {
  return dropStatus.trim().toLowerCase() === 'dropped';
}

export async function savePhysicalVisitBatch(input: SavePhysicalVisitInput) {
  const visitBatchId = cleanVisitBatchId(input.visitBatchId);
  const physicalStopId = crypto.randomUUID();
  const dropStatus = String(input.physicalDrop.dropStatus || '').trim().toLowerCase();
  const dropped = isDroppedStatus(dropStatus);
  const flyerQuantity = dropped
    ? Math.max(1, Math.floor(Number(input.physicalDrop.flyerQuantity) || 1))
    : 0;
  const campaignId = dropped ? (input.physicalDrop.campaignId ?? null) : null;

  const parsedStreet = parseStreetWithSuite(input.street || input.locationAddress);
  const suite = input.suite?.trim() || parsedStreet.suiteLabel || null;
  const street = input.street?.trim() || parsedStreet.fullStreet || null;

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await new sql.Request(transaction)
      .input('PhysicalStopId', sql.UniqueIdentifier, physicalStopId)
      .input('VisitBatchId', sql.UniqueIdentifier, visitBatchId)
      .input('SubmittedByUserId', sql.Int, input.staffUserId)
      .input('PracticeName', sql.NVarChar, input.practiceName)
      .input('LocationAddress', sql.NVarChar, input.locationAddress)
      .input('Street', sql.NVarChar, street)
      .input('Suite', sql.NVarChar, suite)
      .input('City', sql.NVarChar, input.city || null)
      .input('State', sql.VarChar, input.state || null)
      .input('PostalCode', sql.VarChar, input.postalCode || null)
      .input('Latitude', sql.Decimal(10, 7), input.latitude ?? null)
      .input('Longitude', sql.Decimal(10, 7), input.longitude ?? null)
      .input('DropStatus', sql.NVarChar, dropStatus)
      .input('StopType', sql.NVarChar, input.physicalDrop.stopType || null)
      .input('CampaignId', sql.Int, campaignId)
      .input('FlyerTitle', sql.NVarChar, input.physicalDrop.flyerTitle || null)
      .input('FlyerQuantity', sql.Int, flyerQuantity)
      .input('Notes', sql.NVarChar, input.physicalDrop.notes || null)
      .query(`
        INSERT INTO ${PHYSICAL_STOP_TABLE} (
          PhysicalStopId, VisitBatchId, SubmittedByUserId, PracticeName, LocationAddress,
          Street, Suite, City, State, PostalCode, Latitude, Longitude,
          DropStatus, StopType, CampaignId, FlyerTitle, FlyerQuantity, Notes, Status
        )
        VALUES (
          @PhysicalStopId, @VisitBatchId, @SubmittedByUserId, @PracticeName, @LocationAddress,
          @Street, @Suite, @City, @State, @PostalCode, @Latitude, @Longitude,
          @DropStatus, @StopType, @CampaignId, @FlyerTitle, @FlyerQuantity, @Notes, 'pending'
        )
      `);

    if (input.photo?.buffer?.length) {
      await new sql.Request(transaction)
        .input('PhysicalStopId', sql.UniqueIdentifier, physicalStopId)
        .input('FileName', sql.NVarChar, input.photo.originalname)
        .input('ContentType', sql.NVarChar, input.photo.mimetype)
        .input('FileSizeBytes', sql.BigInt, input.photo.size)
        .input('PhotoData', sql.VarBinary(sql.MAX), input.photo.buffer)
        .query(`
          INSERT INTO ${PHOTO_TABLE} (
            AppNewEntryId, PhysicalStopId, FileName, ContentType, FileSizeBytes, PhotoData
          )
          VALUES (
            NULL, @PhysicalStopId, @FileName, @ContentType, @FileSizeBytes, @PhotoData
          )
        `);
    }

    let orgLinkCount = 0;
    for (const org of input.orgLinks) {
      const organizationNpi = String(org.organizationNpi || '').replace(/\D/g, '').slice(0, 10);
      const organizationName = String(org.organizationName || '').trim();
      if (!organizationNpi || !organizationName) continue;

      await new sql.Request(transaction)
        .input('PhysicalStopId', sql.UniqueIdentifier, physicalStopId)
        .input('VisitBatchId', sql.UniqueIdentifier, visitBatchId)
        .input('OrganizationNpi', sql.VarChar, organizationNpi)
        .input('OrganizationName', sql.NVarChar, organizationName)
        .input('OrganizationAddress', sql.NVarChar, org.organizationAddress || null)
        .input('TaxonomyCode', sql.VarChar, org.taxonomyCode || null)
        .input('TaxonomyDescription', sql.NVarChar, org.taxonomyDescription || null)
        .input('DistanceMiles', sql.Decimal(8, 2), org.distanceMiles ?? null)
        .input('SuiteLabel', sql.NVarChar, org.suiteLabel || null)
        .input('VerificationStatus', sql.NVarChar, org.verificationStatus || 'npi_only')
        .input('FlyerAttributed', sql.Bit, org.flyerAttributed ? 1 : 0)
        .query(`
          INSERT INTO ${ORG_LINK_TABLE} (
            PhysicalStopId, VisitBatchId, OrganizationNpi, OrganizationName, OrganizationAddress,
            TaxonomyCode, TaxonomyDescription, DistanceMiles, SuiteLabel,
            VerificationStatus, FlyerAttributed
          )
          VALUES (
            @PhysicalStopId, @VisitBatchId, @OrganizationNpi, @OrganizationName, @OrganizationAddress,
            @TaxonomyCode, @TaxonomyDescription, @DistanceMiles, @SuiteLabel,
            @VerificationStatus, @FlyerAttributed
          )
        `);
      orgLinkCount += 1;
    }

    const confirmedOrg = input.orgLinks.find(
      (org) => String(org.verificationStatus || '').toLowerCase() === 'confirmed_on_site',
    );
    const fallbackOrgNpi = confirmedOrg
      ? String(confirmedOrg.organizationNpi || '').replace(/\D/g, '').slice(0, 10) || null
      : null;

    const providerEntryIds: number[] = [];
    for (const provider of input.providers) {
      if (!provider.selectedForReview) continue;

      const npi = String(provider.npi || '').replace(/\D/g, '').slice(0, 10);
      const providerName = String(provider.providerName || '').trim();
      const providerAddress = String(provider.providerAddress || input.locationAddress || '').trim();
      if (!providerName || !providerAddress) continue;

      const insertResult = await new sql.Request(transaction)
        .input('SubmittedByUserId', sql.Int, input.staffUserId)
        .input('VisitBatchId', sql.UniqueIdentifier, visitBatchId)
        .input('PhysicalStopId', sql.UniqueIdentifier, physicalStopId)
        .input('OrganizationNpi', sql.VarChar, fallbackOrgNpi)
        .input('IsOrgFlyerRow', sql.Bit, 0)
        .input('PracticeName', sql.NVarChar, input.practiceName)
        .input('LocationAddress', sql.NVarChar, input.locationAddress)
        .input('ProviderName', sql.NVarChar, providerName)
        .input('ProviderAddress', sql.NVarChar, providerAddress)
        .input('NpiNumber', sql.VarChar, npi || null)
        .input('Phone', sql.VarChar, provider.phone || null)
        .input('TaxonomyCode', sql.VarChar, provider.taxonomyCode || null)
        .input('TaxonomyDesc', sql.NVarChar, provider.taxonomyDesc || null)
        .input('PrimaryTaxonomy', sql.NVarChar, provider.primaryTaxonomy || null)
        .input('SelectedTaxonomy', sql.NVarChar, provider.selectedTaxonomy || null)
        .input('TaxonomyState', sql.VarChar, provider.taxonomyState || null)
        .input('LicenseNumber', sql.NVarChar, provider.licenseNumber || null)
        .input('CampaignId', sql.Int, null)
        .input('FlyerTitle', sql.NVarChar, null)
        .input('FlyerDropped', sql.Bit, 0)
        .input('VerificationStatus', sql.NVarChar, provider.verificationStatus || 'selected_for_review')
        .input('Latitude', sql.Decimal(10, 7), input.latitude ?? null)
        .input('Longitude', sql.Decimal(10, 7), input.longitude ?? null)
        .query(`
          INSERT INTO ${ENTRY_TABLE} (
            SubmittedByUserId, VisitBatchId, PhysicalStopId, OrganizationNpi, IsOrgFlyerRow,
            PracticeName, LocationAddress, ProviderName, ProviderAddress,
            NpiNumber, Phone, TaxonomyCode, TaxonomyDesc, PrimaryTaxonomy, SelectedTaxonomy,
            TaxonomyState, LicenseNumber, CampaignId, FlyerTitle, FlyerDropped,
            VerificationStatus, Latitude, Longitude, Status
          )
          OUTPUT INSERTED.AppNewEntryId
          VALUES (
            @SubmittedByUserId, @VisitBatchId, @PhysicalStopId, @OrganizationNpi, @IsOrgFlyerRow,
            @PracticeName, @LocationAddress, @ProviderName, @ProviderAddress,
            @NpiNumber, @Phone, @TaxonomyCode, @TaxonomyDesc, @PrimaryTaxonomy, @SelectedTaxonomy,
            @TaxonomyState, @LicenseNumber, @CampaignId, @FlyerTitle, @FlyerDropped,
            @VerificationStatus, @Latitude, @Longitude, 'pending'
          )
        `);

      providerEntryIds.push(Number(insertResult.recordset[0].AppNewEntryId));
    }

    await transaction.commit();

    return {
      visitBatchId,
      physicalStopId,
      orgLinkCount,
      providerCount: providerEntryIds.length,
      providerEntryIds,
      submittedAt: new Date().toISOString(),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
