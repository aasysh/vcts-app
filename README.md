# VCTS Helper

Android app that creates VCTS consignments (vctsdri.dri.gov.np) from a short form:
type the bill/challan numbers, cartons, amounts and destination; the app logs in, fills
Add Consignment, saves each bill, locks the consignment, starts the vehicle and saves the
print page as a PDF to share on WhatsApp.

- Vehicle, driver, goods, unit and your firm's details are set once in **Settings**.
- The VCTS password is stored only on the phone, encrypted with the Android key store.
- **Test** mode fills the VCTS form without saving anything, so you can check it.

## Building

Every push to `main` builds the APK with GitHub Actions
(Actions → latest "Build APK" run → Artifacts → `VCTS-Helper-apk`).
