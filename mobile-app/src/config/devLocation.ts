export type DevGpsLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

/** Downtown St Pete — dense NPI practices for dev testing (very close to 205 MLK St N). */
export const DOWNTOWN_ST_PETE_TEST_LOCATION: DevGpsLocation = {
  label: 'Downtown St Pete (test)',
  latitude: 27.7676,
  longitude: -82.6403,
};

/**
 * Pinellas Point / 33734 area — matches Brian Bill Foundation mailing territory.
 * ~1.0 mi straight-line to 205 Dr MLK St N (matches Google driving ~1 mi better than downtown coords).
 */
export const BRIAN_BILL_FOUNDATION_TEST_LOCATION: DevGpsLocation = {
  label: 'Brian Bill Foundation, 33734 (test)',
  latitude: 27.7565,
  longitude: -82.6380,
};

/** @deprecated Use BRIAN_BILL_FOUNDATION_TEST_LOCATION or DOWNTOWN_ST_PETE_TEST_LOCATION */
export const ST_PETERSBURG_TEST_LOCATION = BRIAN_BILL_FOUNDATION_TEST_LOCATION;

/** PHC / 1839 Central Ave, Saint Petersburg, FL 33713 */
export const CENTRAL_AVE_1839_TEST_LOCATION: DevGpsLocation = {
  label: '1839 Central Ave, 33713 (test)',
  latitude: 27.7711976,
  longitude: -82.6585669,
};

/** 189 Dr M.L.K. Jr St N, St. Petersburg, FL 33701. Just south of 205 MLK on the same block. */
export const MLK_189_TEST_LOCATION: DevGpsLocation = {
  label: '189 Dr MLK Jr St N, 33701 (test)',
  latitude: 27.7708,
  longitude: -82.64532,
};

export const DEV_TEST_LOCATIONS: DevGpsLocation[] = [
  BRIAN_BILL_FOUNDATION_TEST_LOCATION,
  DOWNTOWN_ST_PETE_TEST_LOCATION,
  CENTRAL_AVE_1839_TEST_LOCATION,
  MLK_189_TEST_LOCATION,
  {
    label: 'North Kenwood 33713 (test)',
    latitude: 27.7918,
    longitude: -82.6793,
  },
];
