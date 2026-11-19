# Client Prompt Coverage

This build implements the full doctor/pharmacy flyer distribution workflow requested by the client. The core implementation is in:

- `database/006_client_prompt_full_workflow.sql`
- `backend-api/src/modules/client-workflow/client-workflow.routes.ts`
- `admin-dashboard/app/workflow/page.tsx`
- `mobile-app/app/routes/today.tsx`
- `mobile-app/app/delivery/form.tsx`

## 12 covered prompts / requirements

1. **Doctor database / NPI config**  
   The workflow exposes NPI number, doctor name, specialty, primary-care/specialist category, primary and secondary address fields, phone, fax, license number, taxonomy code, primary taxonomy flag, taxonomy description, market, geography, and active status through the target model.

2. **Doctor filters**  
   Admin can search/filter targets by keyword, specialty, custom specialty, NPI, city, state, ZIP, doctor type/category, market, and radius.

3. **Flyer campaign setup**  
   Campaigns now include flyer title, flyer identifier/code, category, file URL, target audience, and default visit frequency.

4. **Assign flyer to doctors/pharmacies**  
   A campaign targeting config links a flyer campaign to doctors/pharmacies. Suggestions become assignments after admin approval.

5. **Geo/radius/market targeting**  
   Targeting configs store target city/state, market number, center coordinates, and radius miles. The backend filters by distance and supports Pinellas Park/St. Petersburg defaults.

6. **Approval before release**  
   Generated assignments start as `suggested`. Admin approves or rejects them before field users see them.

7. **Field person/distributor work list**  
   Approved assignments are assigned to `Master_User` staff records. The mobile app’s Today Route page only shows the logged-in user's approved work.

8. **Route planning**  
   Admin route generation orders stops from a start city/current location using nearest-next distance and creates route stop records.

9. **Calendar / schedule**  
   Assignments have `ScheduledDate`; routes have `RouteDate`; the mobile app loads today’s scheduled route.

10. **Visit frequency**  
    Assignments store `VisitFrequencyDays`, `LastVisitDate`, and `NextVisitDueDate`. Completion updates last visit and calculates the next due date.

11. **GPS check-in**  
    Mobile check-in validates distance from the assigned target and stores check-in GPS coordinates, time, and distance.

12. **Proof photo and completion**  
    Delivery submission links back to the assignment/route/target, uploads proof photo, updates assignment/route stop status, and exposes results in deliveries/reports.

## Required migration order

Run the SQL files in order:

1. `database/001_schema.sql`
2. `database/004_specialty_workflow_existing_tables.sql` if not already applied
3. `database/006_client_prompt_full_workflow.sql`

The new admin Workflow page expects migration 006 to exist. Migration 006 is idempotent and also repairs partial earlier runs by adding missing workflow columns before indexes are created.

## Main API endpoints

- `GET /api/client-workflow/coverage`
- `GET /api/client-workflow/targets`
- `POST /api/client-workflow/targets`
- `GET /api/client-workflow/campaign-configs`
- `POST /api/client-workflow/campaign-configs`
- `POST /api/client-workflow/campaign-configs/:configId/suggestions`
- `GET /api/client-workflow/assignments`
- `POST /api/client-workflow/assignments/approve`
- `POST /api/client-workflow/assignments/reject`
- `POST /api/client-workflow/routes/generate`
- `GET /api/client-workflow/routes/today`
- `POST /api/client-workflow/assignments/:assignmentId/checkin`
