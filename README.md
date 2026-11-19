# Pharmacy Flyer Tracker MVP

This project uses your existing SQL Server tables:

- `dbo.Master_User`
- `dbo.Master_Doctor`

It creates only these new tables:

- `dbo.PharmacyFlyer_Campaign`
- `dbo.PharmacyFlyer_Delivery`
- `dbo.PharmacyFlyer_DeliveryPhoto`

## Apps

- `backend-api` - Node.js Express TypeScript API
- `mobile-app` - Expo React Native staff app
- `admin-dashboard` - Next.js admin dashboard
- `database` - SQL Server scripts

## Main flow

Staff logs in with `Master_User` -> selects campaign -> searches doctor from `Master_Doctor` -> takes proof photo -> captures GPS -> submits delivery -> admin sees delivery list/map/photo.

## Client workflow build notes

This package includes the full client-requested flyer distribution workflow. After applying the existing schema, run:

```sql
:r database/006_client_prompt_full_workflow.sql
```

Then use the admin dashboard **Workflow** page to create doctor/pharmacy targeting configs, generate suggestions, approve assignments, assign a field person, and generate a route. Field users can log in to the mobile app and open **Today’s Assigned Route** to check in, view the assigned flyer, upload proof, and complete each stop.

See `docs/client-prompt-coverage.md` for the 12 covered client prompts and endpoint list.
