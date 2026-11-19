# Real Pinellas Park Drop-Off Check-In

This update adds the real app-side check-in gate to the existing delivery form.

## What changed

### Mobile app

File changed:

- `mobile-app/app/delivery/form.tsx`

The delivery form now has a **Drop-off check-in** section. The app:

1. Reads the selected doctor's drop-off coordinates.
2. Watches the flyer dropper's live GPS.
3. Calculates distance in miles.
4. Keeps **Check In at Drop-Off** disabled until the user is within 25 miles.
5. Calls `POST /api/workflow/checkin` with `autoConfirm: true` after the user taps the enabled button.
6. Blocks final delivery submit until check-in is confirmed.

### Doctor coordinates

File added:

- `database/005_master_doctor_dropoff_coordinates.sql`

This adds these fields to `dbo.Master_Doctor`:

- `DropoffLatitude`
- `DropoffLongitude`
- `DropoffCoordinateSource`
- `DropoffGeocodedAt`

The app uses these fields for the real destination/drop-off location.

### Backend doctor search

File changed:

- `backend-api/src/modules/doctors/doctors.routes.ts`

Doctor search now returns `DropoffLatitude` and `DropoffLongitude`, so the mobile app can calculate whether the check-in button should be enabled.

## How to prepare a Pinellas Park doctor

Run the migration first:

```sql
:r database/005_master_doctor_dropoff_coordinates.sql
```

Then update the real Pinellas Park doctor/drop-off record:

```sql
UPDATE dbo.Master_Doctor
SET DropoffLatitude = 27.8428,
    DropoffLongitude = -82.6995,
    DropoffCoordinateSource = 'manual-pinellas-park',
    DropoffGeocodedAt = SYSDATETIME()
WHERE ID = <REAL_MASTER_DOCTOR_ID>;
```

Replace `<REAL_MASTER_DOCTOR_ID>` with the real doctor ID.

## How the user checks in

1. User selects campaign.
2. User searches/selects the Pinellas Park doctor.
3. User opens the delivery form.
4. The app starts watching the user's current GPS.
5. If the user is outside 25 miles, the check-in button remains disabled.
6. When the user reaches the drop-off radius, the button becomes enabled.
7. User taps **Check In at Drop-Off**.
8. Backend creates a confirmed check-in row in `PharmacyFlyer_Delivery` and assigns campaign/flyer using doctor specialty mapping.
9. The final submit button remains disabled until this check-in succeeds.

## Important

This uses real GPS only if the selected doctor has drop-off coordinates. If `DropoffLatitude` / `DropoffLongitude` are missing, the app will show a warning and check-in will stay disabled.
