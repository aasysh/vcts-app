# VCTS Helper

Android app that creates VCTS consignments (vctsdri.dri.gov.np) from a short form, for a user who
finds the website hard to use. It follows the website's own steps:
**Save → Lock Consignment → Start Vehicle → Print Consignment**, then later **End Delivery**
(per bill or all at once) and **Add Mid-Consignment** while a vehicle is on the way.

- **New consignment:** बिल or चलान, supplier (KAMANA TRADERS / DANGAL BROTHERS), customer found by
  typing the PAN, cartons, amount (shown in words), date (आज / हिजो / अस्ति). A चलान always goes to
  "Mobile Sales" with Morang or Sunsari as the place of sales.
- **Final check before saving:** the app asks VCTS for the name of every PAN, the driver and today's
  date, and warns about an unusual price per carton, a bill number already in VCTS, or a consignment
  still on the way. Nothing is saved until the user confirms twice.
- **Customers** are imported from past consignments in VCTS and can be searched by PAN or name.
- **Photo (JPEG) and PDF** of each consignment, saved to the Gallery (VCTS album) and shareable on WhatsApp.
- **Font size** in Settings. **“Send to son”** button on every error (WhatsApp).
- Login, vehicle, driver, suppliers and Test mode are hidden: Settings → tap the version line 5 times.
- The VCTS password is stored only on the phone, encrypted with the Android key store.

## Building

Every push to `main` builds the APK with GitHub Actions; the latest APK is also published on the
`apk` branch as `VCTS-Helper.apk`.
