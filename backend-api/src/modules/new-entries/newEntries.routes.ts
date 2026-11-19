import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdminOrManager } from '../../middleware/role.middleware.js';
import { upload } from '../../middleware/upload.middleware.js';
import { fetchNppesProviderByNpi, formatProviderAddress } from '../../services/nppesLookup.js';
import { parseUsAddressLine } from '../../utils/parseUsAddress.js';
import { buildPaginatedResponse, parsePaginationQuery } from '../../utils/pagination.js';
import { matchActiveFlyersForTaxonomy } from './newEntriesFlyerMatch.js';
import { getRepLocationHints, resolveAddressHints } from './newEntriesLocation.js';
import { lookupProvidersAtLocation } from './newEntriesNpiLookup.js';
import { findNearbyOrganizations } from './newEntriesNearbyOrgs.js';
import { listActiveFlyersWithRecommendations, listAllActiveFlyers, buildFlyerRecommendations } from './newEntriesActiveFlyers.js';
import { buildNpiSummaryAtAddress } from './newEntriesNpiSummary.js';
import { lookupProvidersAtAddress, lookupProvidersAtOrgAddress } from './newEntriesOrgProviders.js';
import { savePhysicalVisitBatch } from './newEntriesPhysicalVisitSave.js';
import { saveOrgVisitBatch } from './newEntriesVisitSave.js';

export const newEntriesRoutes = Router();
newEntriesRoutes.use(requireAuth);

const ENTRY_TABLE = 'dbo.PharmacyFlyer_APPNewEntries';
const PHOTO_TABLE = 'dbo.PharmacyFlyer_APPNewEntryPhoto';

function cleanText(value: unknown, maxLen: number) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.slice(0, maxLen);
}

function parseCoordinate(value: unknown) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseCampaignId(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
}

newEntriesRoutes.post('/', upload.single('photo'), async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  const practiceName = cleanText(req.body?.practiceName, 200);
  const locationAddress = cleanText(req.body?.locationAddress, 500);
  const providerName = cleanText(req.body?.providerName, 200);
  const providerAddress = cleanText(req.body?.providerAddress, 500);
  const npiNumber = cleanText(req.body?.npiNumber ?? req.body?.npi, 20).replace(/\D/g, '').slice(0, 10) || null;
  const phone = cleanText(req.body?.phone, 30);
  const taxonomyCode = cleanText(req.body?.taxonomyCode, 20) || null;
  const taxonomyDesc = cleanText(req.body?.taxonomyDesc, 255);
  const primaryTaxonomy = cleanText(req.body?.primaryTaxonomy, 10) || null;
  const selectedTaxonomy = cleanText(req.body?.selectedTaxonomy, 255) || null;
  const taxonomyState = cleanText(req.body?.taxonomyState, 10) || null;
  const licenseNumber = cleanText(req.body?.licenseNumber, 50) || null;
  const campaignId = parseCampaignId(req.body?.campaignId);
  const flyerTitle = cleanText(req.body?.flyerTitle, 200) || null;
  const flyerDropped = parseBoolean(req.body?.flyerDropped);
  const latitude = parseCoordinate(req.body?.latitude ?? req.body?.lat);
  const longitude = parseCoordinate(req.body?.longitude ?? req.body?.lng);

  if (!practiceName) {
    return res.status(400).json({ message: 'Practice name is required.' });
  }
  if (!locationAddress) {
    return res.status(400).json({ message: 'Location address is required.' });
  }
  if (!providerName) {
    return res.status(400).json({ message: 'Provider name is required.' });
  }
  if (!providerAddress) {
    return res.status(400).json({ message: 'Provider address is required.' });
  }
  if (!flyerDropped) {
    return res.status(400).json({ message: 'Drop a flyer before saving this entry.' });
  }
  if (!campaignId) {
    return res.status(400).json({ message: 'A flyer selection is required.' });
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input('SubmittedByUserId', sql.Int, staffUserId)
      .input('PracticeName', sql.NVarChar, practiceName)
      .input('LocationAddress', sql.NVarChar, locationAddress)
      .input('ProviderName', sql.NVarChar, providerName)
      .input('ProviderAddress', sql.NVarChar, providerAddress)
      .input('NpiNumber', sql.VarChar, npiNumber)
      .input('Phone', sql.VarChar, phone || null)
      .input('TaxonomyCode', sql.VarChar, taxonomyCode)
      .input('TaxonomyDesc', sql.NVarChar, taxonomyDesc || null)
      .input('PrimaryTaxonomy', sql.NVarChar, primaryTaxonomy)
      .input('SelectedTaxonomy', sql.NVarChar, selectedTaxonomy)
      .input('TaxonomyState', sql.VarChar, taxonomyState)
      .input('LicenseNumber', sql.NVarChar, licenseNumber)
      .input('CampaignId', sql.Int, campaignId)
      .input('FlyerTitle', sql.NVarChar, flyerTitle)
      .input('FlyerDropped', sql.Bit, 1)
      .input('Latitude', sql.Decimal(10, 7), latitude)
      .input('Longitude', sql.Decimal(10, 7), longitude)
      .query(`
        INSERT INTO ${ENTRY_TABLE} (
          SubmittedByUserId, PracticeName, LocationAddress, ProviderName, ProviderAddress,
          NpiNumber, Phone, TaxonomyCode, TaxonomyDesc, PrimaryTaxonomy, SelectedTaxonomy,
          TaxonomyState, LicenseNumber, CampaignId, FlyerTitle, FlyerDropped,
          Latitude, Longitude, Status
        )
        OUTPUT INSERTED.AppNewEntryId, INSERTED.SubmittedAt
        VALUES (
          @SubmittedByUserId, @PracticeName, @LocationAddress, @ProviderName, @ProviderAddress,
          @NpiNumber, @Phone, @TaxonomyCode, @TaxonomyDesc, @PrimaryTaxonomy, @SelectedTaxonomy,
          @TaxonomyState, @LicenseNumber, @CampaignId, @FlyerTitle, @FlyerDropped,
          @Latitude, @Longitude, 'pending'
        )
      `);

    const row = insertResult.recordset[0];
    const appNewEntryId = Number(row.AppNewEntryId);

    if (req.file) {
      await new sql.Request(transaction)
        .input('AppNewEntryId', sql.BigInt, appNewEntryId)
        .input('FileName', sql.NVarChar, req.file.originalname)
        .input('ContentType', sql.NVarChar, req.file.mimetype)
        .input('FileSizeBytes', sql.BigInt, req.file.size)
        .input('PhotoData', sql.VarBinary(sql.MAX), req.file.buffer)
        .query(`
          INSERT INTO ${PHOTO_TABLE} (
            AppNewEntryId, FileName, ContentType, FileSizeBytes, PhotoData
          )
          VALUES (
            @AppNewEntryId, @FileName, @ContentType, @FileSizeBytes, @PhotoData
          )
        `);
    }

    await transaction.commit();

    res.status(201).json({
      appNewEntryId,
      submittedAt: row.SubmittedAt instanceof Date
        ? row.SubmittedAt.toISOString()
        : String(row.SubmittedAt),
      message: 'New entry saved.',
    });
  } catch (error) {
    await transaction.rollback();
    console.error('[new-entries] POST / failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('PharmacyFlyer_APPNewEntries')) {
      return res.status(503).json({
        message: 'New entry table is missing. Run database/025_app_new_entries.sql first.',
      });
    }
    if (message.includes('Invalid column name')) {
      return res.status(503).json({
        message: 'New entry flyer columns are missing. Run database/026_app_new_entries_flyer.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not save new entry.' });
  }
});

newEntriesRoutes.get('/', requireAdminOrManager, async (req, res) => {
  const pool = await getPool();
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);

  const fromClause = `
    FROM ${ENTRY_TABLE} e
    INNER JOIN dbo.Master_User u ON u.ID = e.SubmittedByUserId
    OUTER APPLY (
      SELECT TOP 1 PhotoId
      FROM ${PHOTO_TABLE} p
      WHERE p.AppNewEntryId = e.AppNewEntryId
    ) ph
  `;

  const selectColumns = `
    e.AppNewEntryId,
    e.PracticeName,
    e.LocationAddress,
    e.ProviderName,
    e.ProviderAddress,
    e.NpiNumber,
    e.Phone,
    e.TaxonomyCode,
    e.TaxonomyDesc,
    e.PrimaryTaxonomy,
    e.SelectedTaxonomy,
    e.TaxonomyState,
    e.LicenseNumber,
    e.CampaignId,
    e.FlyerTitle,
    e.FlyerDropped,
    e.Latitude,
    e.Longitude,
    e.Status,
    e.SubmittedAt,
    LTRIM(RTRIM(u.User_FirstName)) AS User_FirstName,
    LTRIM(RTRIM(u.User_LastName)) AS User_LastName,
    CASE WHEN ph.PhotoId IS NULL THEN 0 ELSE 1 END AS HasPhoto
  `;

  try {
    if (pagination) {
      const countResult = await pool.request().query(`
        SELECT COUNT(*) AS total
        ${fromClause}
      `);
      const total = Number(countResult.recordset[0]?.total ?? 0);

      const dataResult = await pool.request()
        .input('Offset', sql.Int, pagination.offset)
        .input('PageSize', sql.Int, pagination.pageSize)
        .query(`
          SELECT ${selectColumns}
          ${fromClause}
          ORDER BY e.SubmittedAt DESC
          OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
        `);

      return res.json(buildPaginatedResponse(dataResult.recordset, total, pagination));
    }

    const dataResult = await pool.request().query(`
      SELECT TOP 500 ${selectColumns}
      ${fromClause}
      ORDER BY e.SubmittedAt DESC
    `);

    res.json({ items: dataResult.recordset });
  } catch (error) {
    console.error('[new-entries] GET / failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('PharmacyFlyer_APPNewEntries')) {
      return res.status(503).json({
        message: 'New entry table is missing. Run database/025_app_new_entries.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not load new entries.' });
  }
});

newEntriesRoutes.get('/location-hints', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const lat = parseCoordinate(req.query.lat ?? req.query.latitude);
  const lng = parseCoordinate(req.query.lng ?? req.query.longitude);
  if (lat == null || lng == null) {
    return res.status(400).json({ message: 'Valid lat/lng are required.' });
  }

  try {
    const hints = await getRepLocationHints(userId, lat, lng);
    res.json(hints);
  } catch (error) {
    console.error('[new-entries] GET /location-hints failed:', error);
    res.status(500).json({ message: 'Could not load location hints.' });
  }
});

newEntriesRoutes.get('/resolve-address', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const address = cleanText(req.query.address, 500);
  if (!address) {
    return res.status(400).json({ message: 'Address text is required.' });
  }

  try {
    const result = await resolveAddressHints(userId, address);
    if ('error' in result && result.error) {
      return res.status(400).json({ message: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('[new-entries] GET /resolve-address failed:', error);
    res.status(500).json({ message: 'Could not resolve typed address.' });
  }
});

function parseProvidersJson(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

newEntriesRoutes.get('/nearby-orgs', async (req, res) => {
  const lat = parseCoordinate(req.query.lat ?? req.query.latitude);
  const lng = parseCoordinate(req.query.lng ?? req.query.longitude);
  const radiusMiles = parseCoordinate(req.query.radiusMiles ?? req.query.radius);
  const addressText = cleanText(req.query.address, 500) || null;
  const parsed = addressText ? parseUsAddressLine(addressText) : null;
  const city = cleanText(req.query.city, 100) || parsed?.city || null;
  const state = cleanText(req.query.state, 10) || parsed?.state || 'FL';
  const postalCode = cleanText(req.query.postalCode ?? req.query.zip, 20) || parsed?.postalCode || null;
  const street = cleanText(req.query.street, 200) || parsed?.street || null;

  if (lat == null && lng == null && !postalCode && !city && !addressText) {
    return res.status(400).json({
      message: 'Provide lat/lng or a full address like 5398 Park St N, St Petersburg, FL, 33709',
    });
  }

  try {
    const result = await findNearbyOrganizations({
      latitude: lat,
      longitude: lng,
      radiusMiles: radiusMiles ?? undefined,
      street,
      city,
      state,
      postalCode,
      addressText,
    });
    res.json(result);
  } catch (error) {
    console.error('[new-entries] GET /nearby-orgs failed:', error);
    res.status(500).json({ message: 'Could not search nearby organizations.' });
  }
});

newEntriesRoutes.get('/orgs/:npi', async (req, res) => {
  const npi = cleanText(req.params.npi, 20).replace(/\D/g, '').slice(0, 10);
  if (!npi) return res.status(400).json({ message: 'Valid organization NPI is required.' });

  try {
    const provider = await fetchNppesProviderByNpi(npi);
    if (!provider) return res.status(404).json({ message: 'Organization not found in NPI Registry.' });
    if (!provider.isOrganization) {
      return res.status(400).json({ message: 'This NPI is not an organization (NPI-2).' });
    }

    const matchedFlyers = await matchActiveFlyersForTaxonomy({
      taxonomyCode: provider.taxonomyCode,
      taxonomyDesc: provider.taxonomyDesc,
    });

    res.json({
      organization: {
        npi: provider.npi,
        organizationName: provider.providerName,
        organizationAddress: formatProviderAddress(provider),
        taxonomyCode: provider.taxonomyCode,
        taxonomyDesc: provider.taxonomyDesc,
        primaryTaxonomy: provider.primaryTaxonomy,
        selectedTaxonomy: provider.selectedTaxonomy,
        taxonomyState: provider.taxonomyState,
        licenseNumber: provider.licenseNumber,
        phone: provider.phone,
        taxonomies: provider.taxonomies,
      },
      matchedFlyers,
    });
  } catch (error) {
    console.error('[new-entries] GET /orgs/:npi failed:', error);
    res.status(500).json({ message: 'Could not load organization details.' });
  }
});

function parseBooleanQuery(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const text = String(value).trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

newEntriesRoutes.get('/active-flyers', async (req, res) => {
  const taxonomyCodesRaw = cleanText(req.query.taxonomyCodes, 2000);
  const taxonomyDescsRaw = cleanText(req.query.taxonomyDescs, 4000);
  const providerNpisRaw = cleanText(req.query.providerNpis, 2000);
  const taxonomyCodes = taxonomyCodesRaw ? taxonomyCodesRaw.split(',').map((v) => v.trim()).filter(Boolean) : [];
  const taxonomyDescs = taxonomyDescsRaw ? taxonomyDescsRaw.split('|').map((v) => v.trim()) : [];
  const providerNpis = providerNpisRaw ? providerNpisRaw.split(',').map((v) => v.trim()).filter(Boolean) : [];
  const highDensity = parseBooleanQuery(req.query.highDensity);
  const virtualOffice = parseBooleanQuery(req.query.virtualOffice);
  const guessOnly = parseBooleanQuery(req.query.guessOnly ?? req.query.guess);

  try {
    const payload = await buildFlyerRecommendations({
      taxonomyCodes,
      taxonomyDescs,
      providerNpis,
      highDensity,
      virtualOffice,
    });

    if (guessOnly) {
      const dropNames = [...new Set(
        payload.recommendations
          .map((item) => String(item.flyerTitle || item.campaignName || '').trim())
          .filter(Boolean),
      )];
      const primary = payload.primaryRecommendation;
      return res.json({
        ...payload,
        dropNames,
        dropNamesText: dropNames.join(', '),
        primaryFlyer: primary
          ? {
              campaignId: primary.campaignId,
              campaignName: primary.campaignName,
              flyerTitle: primary.flyerTitle,
            }
          : null,
        primaryRecommendation: primary,
      });
    }

    const flyers = taxonomyCodes.length || taxonomyDescs.length || providerNpis.length
      ? await listActiveFlyersWithRecommendations(taxonomyCodes, taxonomyDescs, {
          providerNpis,
          highDensity,
          virtualOffice,
        })
      : await listAllActiveFlyers();
    res.json({
      ...payload,
      flyers,
    });
  } catch (error) {
    console.error('[new-entries] GET /active-flyers failed:', error);
    res.status(500).json({ message: 'Could not load active flyers.' });
  }
});

newEntriesRoutes.get('/npi-summary-at-address', async (req, res) => {
  const lat = parseCoordinate(req.query.lat ?? req.query.latitude);
  const lng = parseCoordinate(req.query.lng ?? req.query.longitude);
  const addressText = cleanText(req.query.address, 500) || null;
  const parsed = addressText ? parseUsAddressLine(addressText) : null;
  const city = cleanText(req.query.city, 100) || parsed?.city || null;
  const state = cleanText(req.query.state, 10) || parsed?.state || 'FL';
  const postalCode = cleanText(req.query.postalCode ?? req.query.zip, 20) || parsed?.postalCode || null;
  const street = cleanText(req.query.street, 200) || parsed?.street || null;
  const exactSuite = parseBooleanQuery(req.query.exactSuite);
  const dropStatus = cleanText(req.query.dropStatus, 50) || null;

  try {
    const summary = await buildNpiSummaryAtAddress({
      latitude: lat,
      longitude: lng,
      addressText,
      street,
      city,
      state,
      postalCode,
      exactSuite,
      dropStatus,
    });
    res.json(summary);
  } catch (error) {
    console.error('[new-entries] GET /npi-summary-at-address failed:', error);
    res.status(500).json({ message: 'Could not build NPI summary for this address.' });
  }
});

newEntriesRoutes.get('/providers-at-address', async (req, res) => {
  const addressText = cleanText(req.query.address, 500) || null;
  const parsed = addressText ? parseUsAddressLine(addressText) : null;
  const city = cleanText(req.query.city, 100) || parsed?.city || null;
  const state = cleanText(req.query.state, 10) || parsed?.state || 'FL';
  const postalCode = cleanText(req.query.postalCode ?? req.query.zip, 20) || parsed?.postalCode || null;
  const street = cleanText(req.query.street, 200) || parsed?.street || null;
  const exactSuite = parseBooleanQuery(req.query.exactSuite);

  try {
    const result = await lookupProvidersAtAddress({
      street,
      city,
      state,
      postalCode,
      exactSuite,
    });
    if ('error' in result && result.error) {
      return res.status(400).json({ message: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('[new-entries] GET /providers-at-address failed:', error);
    res.status(500).json({ message: 'Could not load providers at this address.' });
  }
});

newEntriesRoutes.post('/physical-visit', upload.single('photo'), async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  const practiceName = cleanText(req.body?.practiceName, 200);
  const locationAddress = cleanText(req.body?.locationAddress, 500);
  const street = cleanText(req.body?.street, 200) || null;
  const suite = cleanText(req.body?.suite, 100) || null;
  const city = cleanText(req.body?.city, 100) || null;
  const state = cleanText(req.body?.state, 10) || null;
  const postalCode = cleanText(req.body?.postalCode ?? req.body?.zip, 20) || null;
  const latitude = parseCoordinate(req.body?.latitude ?? req.body?.lat);
  const longitude = parseCoordinate(req.body?.longitude ?? req.body?.lng);
  const visitBatchId = cleanText(req.body?.visitBatchId, 36) || null;

  const physicalDropRaw = parseJsonObject(req.body?.physicalDropJson ?? req.body?.physicalDrop);
  const dropStatus = cleanText(physicalDropRaw.dropStatus, 50);
  const stopType = cleanText(physicalDropRaw.stopType, 50) || null;
  const campaignId = parseCampaignId(physicalDropRaw.campaignId);
  const flyerTitle = cleanText(physicalDropRaw.flyerTitle, 200) || null;
  const flyerQuantity = Number(physicalDropRaw.flyerQuantity);
  const notes = cleanText(physicalDropRaw.notes, 1000) || null;
  const droppedAt = cleanText(physicalDropRaw.droppedAt, 40) || null;

  if (!practiceName) return res.status(400).json({ message: 'Practice name is required.' });
  if (!locationAddress) return res.status(400).json({ message: 'Location address is required.' });
  if (!dropStatus) return res.status(400).json({ message: 'Drop status is required.' });

  const dropped = dropStatus.toLowerCase() === 'dropped';
  if (dropped && !campaignId) {
    return res.status(400).json({ message: 'A flyer campaign is required when drop status is Dropped.' });
  }
  if (dropped && (!Number.isFinite(flyerQuantity) || flyerQuantity < 1)) {
    return res.status(400).json({ message: 'Flyer quantity must be at least 1 when drop status is Dropped.' });
  }

  const orgLinksRaw = parseJsonArray(req.body?.orgLinksJson ?? req.body?.orgLinks);
  const orgLinks = orgLinksRaw.map((row) => ({
    organizationNpi: cleanText(row.organizationNpi ?? row.npi, 20).replace(/\D/g, '').slice(0, 10),
    organizationName: cleanText(row.organizationName ?? row.name, 200),
    organizationAddress: cleanText(row.organizationAddress ?? row.address, 500) || null,
    taxonomyCode: cleanText(row.taxonomyCode, 20) || null,
    taxonomyDescription: cleanText(row.taxonomyDescription ?? row.taxonomyDesc, 255) || null,
    distanceMiles: parseCoordinate(row.distanceMiles),
    suiteLabel: cleanText(row.suiteLabel, 100) || null,
    verificationStatus: cleanText(row.verificationStatus, 50) || 'npi_only',
    flyerAttributed: parseBoolean(row.flyerAttributed),
  })).filter((row) => row.organizationNpi && row.organizationName);

  const providersRaw = parseJsonArray(req.body?.providersJson ?? req.body?.providers);
  const providers = providersRaw.map((row) => ({
    npi: cleanText(row.npi, 20).replace(/\D/g, '').slice(0, 10),
    providerName: cleanText(row.providerName, 200),
    providerAddress: cleanText(row.providerAddress, 500),
    phone: cleanText(row.phone, 30) || null,
    taxonomyCode: cleanText(row.taxonomyCode, 20) || null,
    taxonomyDesc: cleanText(row.taxonomyDesc ?? row.taxonomyDescription, 255) || null,
    primaryTaxonomy: cleanText(row.primaryTaxonomy, 10) || null,
    selectedTaxonomy: cleanText(row.selectedTaxonomy, 255) || null,
    taxonomyState: cleanText(row.taxonomyState, 10) || null,
    licenseNumber: cleanText(row.licenseNumber, 50) || null,
    verificationStatus: cleanText(row.verificationStatus, 50) || null,
    selectedForReview: parseBoolean(row.selectedForReview),
  })).filter((row) => row.npi && row.providerName && row.providerAddress);

  try {
    const result = await savePhysicalVisitBatch({
      staffUserId,
      visitBatchId,
      practiceName,
      locationAddress,
      street,
      suite,
      city,
      state,
      postalCode,
      latitude,
      longitude,
      physicalDrop: {
        dropStatus,
        stopType,
        campaignId,
        flyerTitle,
        flyerQuantity: dropped ? Math.max(1, Math.floor(flyerQuantity || 1)) : 0,
        notes,
        droppedAt,
      },
      orgLinks,
      providers,
      photo: req.file
        ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            buffer: req.file.buffer,
          }
        : null,
    });

    res.status(201).json({
      ...result,
      message: `Saved physical stop${result.orgLinkCount ? `, ${result.orgLinkCount} org link${result.orgLinkCount === 1 ? '' : 's'}` : ''}${result.providerCount ? `, ${result.providerCount} provider candidate${result.providerCount === 1 ? '' : 's'}` : ''}.`,
    });
  } catch (error) {
    console.error('[new-entries] POST /physical-visit failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('PharmacyFlyer_APPPhysicalStops')) {
      return res.status(503).json({
        message: 'Physical stop table is missing. Run database/028_app_physical_stops.sql first.',
      });
    }
    if (message.includes('PharmacyFlyer_APPVisitOrgLinks')) {
      return res.status(503).json({
        message: 'Org link table is missing. Run database/029_app_visit_org_links.sql first.',
      });
    }
    if (message.includes('Invalid column name')) {
      return res.status(503).json({
        message: 'Physical stop extensions are missing. Run database/030_app_physical_stop_extensions.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not save physical visit.' });
  }
});

newEntriesRoutes.get('/orgs/:npi/providers-at-address', async (req, res) => {
  const npi = cleanText(req.params.npi, 20).replace(/\D/g, '').slice(0, 10);
  if (!npi) return res.status(400).json({ message: 'Valid organization NPI is required.' });

  try {
    const result = await lookupProvidersAtOrgAddress(npi);
    if ('error' in result && result.error) {
      return res.status(404).json({ message: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('[new-entries] GET /orgs/:npi/providers-at-address failed:', error);
    res.status(500).json({ message: 'Could not load providers at organization address.' });
  }
});

newEntriesRoutes.post('/visit', upload.single('photo'), async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  const practiceName = cleanText(req.body?.practiceName, 200);
  const locationAddress = cleanText(req.body?.locationAddress, 500);
  const organizationNpi = cleanText(req.body?.organizationNpi, 20).replace(/\D/g, '').slice(0, 10);
  const organizationName = cleanText(req.body?.organizationName, 200);
  const organizationAddress = cleanText(req.body?.organizationAddress, 500);
  const phone = cleanText(req.body?.phone, 30) || null;
  const taxonomyCode = cleanText(req.body?.taxonomyCode, 20) || null;
  const taxonomyDesc = cleanText(req.body?.taxonomyDesc, 255) || null;
  const primaryTaxonomy = cleanText(req.body?.primaryTaxonomy, 10) || null;
  const selectedTaxonomy = cleanText(req.body?.selectedTaxonomy, 255) || null;
  const taxonomyState = cleanText(req.body?.taxonomyState, 10) || null;
  const licenseNumber = cleanText(req.body?.licenseNumber, 50) || null;
  const campaignId = parseCampaignId(req.body?.campaignId);
  const flyerTitle = cleanText(req.body?.flyerTitle, 200) || null;
  const latitude = parseCoordinate(req.body?.latitude ?? req.body?.lat);
  const longitude = parseCoordinate(req.body?.longitude ?? req.body?.lng);
  const visitBatchId = cleanText(req.body?.visitBatchId, 36) || null;
  const providersRaw = parseProvidersJson(req.body?.providers ?? req.body?.providersJson);

  if (!practiceName) return res.status(400).json({ message: 'Practice name is required.' });
  if (!locationAddress) return res.status(400).json({ message: 'Location address is required.' });
  if (!organizationNpi) return res.status(400).json({ message: 'Organization NPI is required.' });
  if (!organizationName) return res.status(400).json({ message: 'Organization name is required.' });
  if (!organizationAddress) return res.status(400).json({ message: 'Organization address is required.' });
  if (!campaignId) return res.status(400).json({ message: 'A flyer selection is required.' });
  if (!parseBoolean(req.body?.flyerDropped)) {
    return res.status(400).json({ message: 'Drop a flyer before saving this visit.' });
  }

  const providers = providersRaw.map((row) => ({
    npi: cleanText(row.npi, 20).replace(/\D/g, '').slice(0, 10),
    providerName: cleanText(row.providerName, 200),
    providerAddress: cleanText(row.providerAddress, 500),
    phone: cleanText(row.phone, 30) || null,
    taxonomyCode: cleanText(row.taxonomyCode, 20) || null,
    taxonomyDesc: cleanText(row.taxonomyDesc, 255) || null,
    primaryTaxonomy: cleanText(row.primaryTaxonomy, 10) || null,
    selectedTaxonomy: cleanText(row.selectedTaxonomy, 255) || null,
    taxonomyState: cleanText(row.taxonomyState, 10) || null,
    licenseNumber: cleanText(row.licenseNumber, 50) || null,
  })).filter((row) => row.npi && row.providerName && row.providerAddress);

  try {
    const result = await saveOrgVisitBatch({
      staffUserId,
      visitBatchId,
      practiceName,
      locationAddress,
      organizationNpi,
      organizationName,
      organizationAddress,
      phone,
      taxonomyCode,
      taxonomyDesc,
      primaryTaxonomy,
      selectedTaxonomy,
      taxonomyState,
      licenseNumber,
      campaignId,
      flyerTitle,
      latitude,
      longitude,
      providers,
      photo: req.file
        ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            buffer: req.file.buffer,
          }
        : null,
    });

    res.status(201).json({
      ...result,
      message: providers.length
        ? `Saved org visit and ${providers.length} provider${providers.length === 1 ? '' : 's'}.`
        : 'Saved org visit.',
    });
  } catch (error) {
    console.error('[new-entries] POST /visit failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('PharmacyFlyer_APPNewEntries')) {
      return res.status(503).json({
        message: 'New entry table is missing. Run database/025_app_new_entries.sql first.',
      });
    }
    if (message.includes('Invalid column name')) {
      return res.status(503).json({
        message: 'Visit columns are missing. Run database/027_app_new_entries_visit.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not save org visit.' });
  }
});

newEntriesRoutes.get('/npi-lookup', async (req, res) => {
  const addressText = cleanText(req.query.address, 500) || null;
  const parsed = addressText ? parseUsAddressLine(addressText) : null;
  const city = cleanText(req.query.city, 100) || parsed?.city || null;
  const state = cleanText(req.query.state, 10) || parsed?.state || 'FL';
  const postalCode = cleanText(req.query.postalCode ?? req.query.zip, 20) || parsed?.postalCode || null;
  const street = cleanText(req.query.street, 200) || parsed?.street || null;
  const phone = cleanText(req.query.phone, 30) || null;

  if (!city && !postalCode) {
    return res.status(400).json({
      message: 'City or ZIP is required. Type a full address like 701 6th St S, St Petersburg, FL, 33701',
    });
  }

  try {
    const result = await lookupProvidersAtLocation({
      city,
      state,
      postalCode,
      street,
      phone,
      addressText,
    });
    res.json(result);
  } catch (error) {
    console.error('[new-entries] GET /npi-lookup failed:', error);
    res.status(500).json({ message: 'Could not search NPI Registry.' });
  }
});

newEntriesRoutes.get('/providers/:npi', async (req, res) => {
  const npi = cleanText(req.params.npi, 20).replace(/\D/g, '').slice(0, 10);
  if (!npi) return res.status(400).json({ message: 'Valid NPI is required.' });

  try {
    const provider = await fetchNppesProviderByNpi(npi);
    if (!provider) return res.status(404).json({ message: 'Provider not found in NPI Registry.' });

    res.json({
      provider: {
        npi: provider.npi,
        providerName: provider.providerName,
        providerAddress: formatProviderAddress(provider),
        primaryPracticeAddress: provider.primaryPracticeAddress,
        secondaryPracticeAddresses: provider.secondaryPracticeAddresses,
        phone: provider.phone,
        taxonomyCode: provider.taxonomyCode,
        taxonomyDesc: provider.taxonomyDesc,
        primaryTaxonomy: provider.primaryTaxonomy,
        selectedTaxonomy: provider.selectedTaxonomy,
        taxonomyState: provider.taxonomyState,
        licenseNumber: provider.licenseNumber,
        practiceName: cleanText(req.query.practiceName, 200) || null,
      },
    });
  } catch (error) {
    console.error('[new-entries] GET /providers/:npi failed:', error);
    res.status(500).json({ message: 'Could not load provider details.' });
  }
});

newEntriesRoutes.get('/:id/photo', requireAdminOrManager, async (req, res) => {
  const entryId = Number(req.params.id);
  if (!Number.isFinite(entryId) || entryId <= 0) {
    return res.status(400).json({ message: 'Valid entry id is required.' });
  }

  const pool = await getPool();
  try {
    const result = await pool.request()
      .input('AppNewEntryId', sql.BigInt, entryId)
      .query(`
        SELECT TOP 1 FileName, ContentType, PhotoData
        FROM ${PHOTO_TABLE}
        WHERE AppNewEntryId = @AppNewEntryId
        ORDER BY PhotoId DESC
      `);

    const photo = result.recordset[0];
    if (!photo) return res.status(404).json({ message: 'Photo not found.' });

    res.setHeader('Content-Type', photo.ContentType || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${photo.FileName || 'business-card.jpg'}"`);
    res.send(photo.PhotoData);
  } catch (error) {
    console.error('[new-entries] GET /:id/photo failed:', error);
    res.status(500).json({ message: 'Could not load photo.' });
  }
});
