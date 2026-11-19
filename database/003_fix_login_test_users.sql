/*
  Fix/check test logins for the Pharmacy Flyer Tracker mobile app.

  The API logs in from dbo.Master_User using active users only:
    User_IsActive = 1 AND (User_Email OR User_Id OR User_Phone matches the login value)

  This script updates existing flyer/Vishal rows if they already exist.
  If they do not exist, it inserts minimal rows using the columns used by the API.
  If your Master_User table has additional NOT NULL columns, add those columns to the INSERT section.
*/
-- See exactly what the login API can find.
SELECT ID,
       User_Id,
       User_FirstName,
       User_LastName,
       User_Email,
       User_Phone,
       User_IsActive,
       User_Password
FROM   dbo.Master_User
WHERE  LOWER(LTRIM(RTRIM(ISNULL(User_Id, '')))) IN ('flyer', 'vishal')
       OR LOWER(LTRIM(RTRIM(ISNULL(User_Email, '')))) IN ('flyer', 'vishal', 'vishalmalkan@gmail.com');

-- Insert flyer test user if missing.
IF NOT EXISTS (SELECT 1
               FROM   dbo.Master_User
               WHERE  LOWER(LTRIM(RTRIM(ISNULL(User_Id, '')))) = 'flyer'
                      OR LOWER(LTRIM(RTRIM(ISNULL(User_Email, '')))) = 'flyer')
  BEGIN
    INSERT  INTO dbo.Master_User (
      User_Id,
      User_FirstName,
      User_LastName,
      User_Email,
      User_Phone,
      User_Password,
      User_IsActive
    )
    VALUES                       ('flyer', 'Flyer', 'User', 'flyer', NULL, 'Password@123', 1);
  END

-- Insert Vishal test user if missing.
IF NOT EXISTS (SELECT 1
               FROM   dbo.Master_User
               WHERE  LOWER(LTRIM(RTRIM(ISNULL(User_Id, '')))) = 'vishal'
                      OR LOWER(LTRIM(RTRIM(ISNULL(User_Email, '')))) = 'vishalmalkan@gmail.com')
  BEGIN
    INSERT  INTO dbo.Master_User (
      User_Id,
      User_FirstName,
      User_LastName,
      User_Email,
      User_Phone,
      User_Password,
      User_IsActive
    )
    VALUES                       ('vishal', 'Vishal', 'Malkan', 'vishalmalkan@gmail.com', NULL, 'Password@123', 1);
  END

-- Verify after fix.
SELECT ID,
       User_Id,
       User_FirstName,
       User_LastName,
       User_Email,
       User_Phone,
       User_IsActive,
       User_Password
FROM   dbo.Master_User
WHERE  LOWER(LTRIM(RTRIM(ISNULL(User_Id, '')))) IN ('flyer', 'vishal')
       OR LOWER(LTRIM(RTRIM(ISNULL(User_Email, '')))) IN ('flyer', 'vishal', 'vishalmalkan@gmail.com');