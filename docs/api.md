# API Endpoints

## Auth

POST `/api/auth/login`

```json
{
  "emailOrMobile": "vishalmalkan@gmail.com",
  "password": "your-password"
}
```

## Campaigns

GET `/api/campaigns/active`

GET `/api/campaigns`

POST `/api/campaigns`

```json
{
  "campaignName": "June Flyer Campaign",
  "description": "Doctors flyer drop campaign"
}
```

## Doctors

GET `/api/doctors/search?q=st petersburg`

Searches `Master_Doctor` by first name, last name, street, city, state, ZIP, phone, mobile, and NPI.

## Deliveries

POST `/api/deliveries`

Multipart form data fields:

- campaignId
- doctorId
- doctorName
- clinicName
- doctorAddressStreet
- doctorAddressCity
- doctorAddressState
- doctorAddressZip
- personMet
- flyerDelivered
- responseStatus
- latitude
- longitude
- gpsAccuracyMeters
- notes
- followUpRequired
- followUpDate
- photo

GET `/api/deliveries`

GET `/api/deliveries/map`

GET `/api/deliveries/:id/photo`

## Reports

GET `/api/reports/dashboard`

GET `/api/reports/export`
