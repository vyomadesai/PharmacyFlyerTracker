# Specialty-based flyer workflow using existing tables

This project already has the core tables, so the workflow should reuse them instead of creating duplicate master tables.

## Existing tables reused

- `dbo.Master_Doctor` — existing doctor master.
- `dbo.PharmacyFlyer_DoctorInfo` — existing doctor specialty source. The workflow reads `[pri-spec]` from here.
- `dbo.PharmacyFlyer_Campaign` — existing flyer/campaign table. This is the flyer master for assignment.
- `dbo.PharmacyFlyer_Delivery` — existing visit/check-in/assignment record.
- `dbo.PharmacyFlyer_DeliveryPhoto` — existing uploaded photo storage.

## New table added

Only one new mapping table is required:

- `dbo.PharmacyFlyer_CampaignSpecialtyMapping`

This supports many-to-many mapping:

- one campaign/flyer can map to many specialties
- one specialty can map to many campaigns/flyers

Example:

```sql
INSERT INTO dbo.PharmacyFlyer_CampaignSpecialtyMapping (CampaignId, PriSpec, RelevanceScore)
VALUES
(1, 'REGISTERED DIETITIAN OR NUTRITION PROFESSIONAL', 100),
(1, 'GENERAL PRACTICE', 90),
(2, 'CLINICAL PSYCHOLOGIST', 100),
(2, 'CLINICAL SOCIAL WORKER', 95);
```

## Why no duplicate tables

Do **not** create these separate tables unless the existing system truly lacks the data:

- `PharmacyFlyer_DoctorType` — replaced by `PharmacyFlyer_DoctorInfo.[pri-spec]`.
- `PharmacyFlyer_Flyer` — replaced by `PharmacyFlyer_Campaign`.
- `PhotoUpload` — replaced by `PharmacyFlyer_DeliveryPhoto`.
- `CheckIn` / `AssignedFlyer` — represented by added workflow columns on `PharmacyFlyer_Delivery`.

## Backend APIs

Mounted under `/api/workflow`:

- `GET /doctor-specialties`
- `POST /assign-flyer`
- `POST /checkin`
- `POST /checkin/:deliveryId/confirm`
- `POST /upload-photo`
- `POST /validate-flyer-match`

## Assignment rule

1. Read specialty from `dbo.PharmacyFlyer_DoctorInfo.[pri-spec]`.
2. Match specialty through `dbo.PharmacyFlyer_CampaignSpecialtyMapping`.
3. Assign the matching `PharmacyFlyer_Campaign`.
4. Store the assignment/check-in on `PharmacyFlyer_Delivery`.
5. Store photo in `PharmacyFlyer_DeliveryPhoto`.
6. Validate exact photo match against the assigned campaign/flyer metadata.

## Strict location rule

The API enforces a strict 25-mile radius using miles between:

- user latitude/longitude
- healthcare/doctor location latitude/longitude

If the distance is greater than 25 miles, check-in is rejected.
