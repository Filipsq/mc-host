#!/usr/bin/env bash
# Signs android/dist/app-release-unsigned.apk into public/pobierz/mchosting.apk.
# Usage: KEYSTORE=/path/mchosting.keystore KEY_PASSWORD=... android/sign/sign.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${KEYSTORE:?set KEYSTORE to the mchosting.keystore path}"
: "${KEY_PASSWORD:?set KEY_PASSWORD}"
JAR="${TMPDIR:-/tmp}/apksig-2.3.0.jar"
[ -s "$JAR" ] || curl -fsSL -o "$JAR" https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
mkdir -p public/pobierz
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$JAR" android/sign/Sign.java android/dist/app-release-unsigned.apk public/pobierz/mchosting.apk "$KEYSTORE" mchosting "$KEY_PASSWORD"
