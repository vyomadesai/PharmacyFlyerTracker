# Smart Route Capacity Logic

The workflow no longer treats every approved assignment as today's mobile route.

## Admin flow

1. Admin suggests targets.
2. Admin approves and assigns targets to a staff member/date.
3. Approved assignments become the route pool/backlog.
4. Generate today's mobile route only selects what fits the worker's capacity.
5. Remaining assignments stay approved/unrouted for a future date or another staff member.

## Default capacity rules

- Full-time route: 390 route minutes, about 40 stops/day, hard cap 50.
- Part-time route: 195 route minutes, about 20 stops/day, hard cap 25.
- Custom route: calculated from entered hours minus admin/buffer time.

## Why

Medical office/pharmacy flyer drops are not residential door-hanger drops. Each stop may include parking, entering the building, front desk interaction, GPS check-in, proof photo, and completion tracking.

## Backend behavior

`POST /api/client-workflow/routes/generate` now:

- Counts only approved/unrouted assignments.
- Applies capacity limits.
- Creates route stops only for today's realistic capacity.
- Marks selected assignments as `routed`.
- Leaves remaining assignments as `approved` backlog.
- Returns `stopCount`, `totalEligible`, and `backlogCount`.

`GET /api/client-workflow/routes/today` now returns only generated/routed stops, not every approved assignment.

This prevents one person from seeing 200 stops in the mobile app.
