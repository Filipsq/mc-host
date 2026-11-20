# Android app (APK outside Google Play)

A Trusted Web Activity made with Bubblewrap: a small Android app that opens
https://mchosting.pl/dashboard full screen in the phone's Chrome. Login (Google
too), payments and push notifications work exactly as on the website, and site
changes reach the app without a new APK. Package: `pl.mchosting.app`.

People download it from https://mchosting.pl/aplikacja (file
`public/pobierz/mchosting.apk`). iPhones can't install apps from outside the App
Store, so that page shows them how to add the website to the home screen.

## Signing key

Kept by the owner only (project files `aplikacja-android/klucz/`), never in git.
Losing it means phones refuse every later update (people would have to uninstall
first). `public/.well-known/assetlinks.json` holds its SHA-256 fingerprint; without
a match the app shows a browser address bar.

## Releasing a new version

1. Bump `appVersionCode` (+1) and `appVersionName` in `twa-manifest.json` and
   `versionCode`/`versionName` in `app/build.gradle`.
2. Push to a work branch. `.github/workflows/android-apk.yml` builds an unsigned
   APK and commits it to `android/dist/`.
3. Pull, then `KEYSTORE=... KEY_PASSWORD=... android/sign/sign.sh` writes the
   signed `public/pobierz/mchosting.apk`. Commit it, delete `android/dist/`.
