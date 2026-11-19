# NPI Registery Feature

This feature was added without changing `dbo.Master_Doctor`.

## What was added

- Backend route: `backend-api/src/modules/npiRegisteryConfig/npiRegisteryConfig.routes.ts`
- Backend mount: `app.use('/api/npi-registery', npiRegisteryConfigRoutes)` in `backend-api/src/app.ts`
- Admin page: `admin-dashboard/app/npi-registery/page.tsx`
- Admin navigation link: `NPI Registery`
- Mobile search update: `mobile-app/app/doctors/search.tsx`
- Mobile doctor type additions: `mobile-app/src/types/types.ts`
- SQL helper script: `database/006_npi_registery_config.sql`

## Admin workflow

1. Open the admin dashboard.
2. Click **NPI Registery**.
3. Search by NPI or doctor name.
4. The page shows values from local `Master_Doctor` and the public NPI Registry.
5. Admin selects the correct value field-by-field.
6. The selected values are saved to `dbo.npiRegisteryConfig`.

`Master_Doctor` is read-only in this workflow.

## Mobile workflow

The doctor search screen now calls:

```text
GET /api/npi-registery/combined-doctor-search?term=<doctor name>&state=FL&limit=10
```

The result combines:

- local doctors from `Master_Doctor`
- NPI Registry doctors, including a separate NPI card when the same NPI already exists locally

NPI Registry results are marked with an **NPI** badge. If the same NPI exists locally, mobile shows both the **LOCAL** card and the **NPI** card so the user can see the registry address/details side-by-side. NPI-only results do not have local drop-off GPS data until the provider is added or mapped in the local system.

## New API endpoints

```text
GET  /api/npi-registery/doctor/:npi
GET  /api/npi-registery/search?term=&city=&state=FL&limit=10
GET  /api/npi-registery/combined-doctor-search?term=&city=&state=FL&limit=10
POST /api/npi-registery/save
```

The backend auto-creates `dbo.npiRegisteryConfig` if it does not exist. You can also run `database/006_npi_registery_config.sql` manually.
