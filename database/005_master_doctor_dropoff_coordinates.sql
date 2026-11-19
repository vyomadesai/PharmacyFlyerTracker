/*
No Master_Doctor alteration is required for the current Pinellas Park check-in build.

The app uses coordinates returned by the doctor search API. For Pinellas Park doctors,
backend-api/src/modules/doctors/doctors.routes.ts derives temporary drop-off coordinates
from Doctor_AddressCity / Doctor_AddressZip:
  Pinellas Park / 33781 / 33782 -> 27.8428, -82.6995

This keeps the workflow testable without ALTER permission on dbo.Master_Doctor.
*/
