# Setup Steps

## 1. SQL Server

Run:

```sql
-- database/001_schema.sql
-- database/002_seed_campaign.sql
```

Make sure these already exist:

```sql
SELECT TOP 1 * FROM dbo.Master_User;
SELECT TOP 1 * FROM dbo.Master_Doctor;
```

## 2. Backend

```bash
cd backend-api
cp .env.example .env
npm install
npm run dev
```

Edit `.env` with your SQL Server details.

Test:

```text
http://localhost:4000/health
```

## 3. Admin Dashboard

```bash
cd admin-dashboard
cp .env.local.example .env.local
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## 4. Mobile App

```bash
cd mobile-app
npm install
npm start
```

Edit `mobile-app/src/services/api.ts`:

```ts
export const API_BASE_URL = 'http://YOUR-COMPUTER-IP:4000/api';
```

Use Expo Go to open the app on iOS/Android.

## Login

Login uses `dbo.Master_User` where `User_IsActive = 1`.

Supported login fields:

- `User_Email`
- `User_Id`
- `User_Phone`

Password handling:

- bcrypt passwords starting with `$2a$`, `$2b$`, `$2y$` are supported.
- legacy encrypted passwords need your existing decrypt/check logic added in `backend-api/src/modules/auth/auth.routes.ts`.

## Login troubleshooting added

If `flyer / Password@123` or `vishal / Password@123` does not work, run:

```sql
-- database/003_fix_login_test_users.sql
```

Then restart the backend and try again.

The mobile login screen now trims the User ID/email/phone value and disables auto-capitalization on the password field.
The backend login query now trims and lower-cases `User_Email` and `User_Id`, so `flyer`, `Flyer`, and values with accidental spaces match the same active user.

Also verify `mobile-app/src/services/api.ts` points to the computer running the backend API. For a real phone using Expo Go, `localhost` will not work; use your computer LAN IP, for example:

```ts
export const API_BASE_URL = 'http://YOUR-COMPUTER-IP:4000/api';
```


## Login 404 troubleshooting

Wrong credentials return HTTP 401 from `POST /api/auth/login`. If the mobile app shows HTTP 404, the request is reaching a server but not the login route. Check:

1. Restart the backend after pulling the latest files: `cd backend-api && npm run dev`.
2. Confirm the backend shows `Backend API running on http://localhost:4000`.
3. From the same computer, open `http://localhost:4000/api/health`. It should return `{"ok":true}`.
4. From the phone browser, open `http://YOUR-COMPUTER-IP:4000/api/health`. It should return `{"ok":true}`.
5. In `mobile-app/src/services/api.ts`, set `API_BASE_URL` to `http://YOUR-COMPUTER-IP:4000/api`.

This build also accepts `/auth/login` in addition to `/api/auth/login`, so the app is more tolerant if the base URL accidentally omits `/api`.
