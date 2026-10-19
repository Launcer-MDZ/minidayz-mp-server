#!/usr/bin/env bash
# Pemakaian: ./scripts/extract-apk.sh MDZ-Reimagined-2_3_8-mp25-Public_sign.apk
set -e
APK="${1:?berikan path APK}"
rm -rf game && mkdir -p game .tmp
unzip -q -o "$APK" 'assets/www/*' -d .tmp
cp -r .tmp/assets/www/. game/
rm -rf .tmp
echo "OK: $(ls game | wc -l) item di game/ (jangan upload ke repo publik)"
