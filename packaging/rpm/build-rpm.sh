#!/usr/bin/env bash
# Baut dist/Simon-Twitch.rpm (auf Fedora/Bazzite oder in einem Fedora-Container).
# Voraussetzungen: nodejs, npm, rpm-build
set -euo pipefail
cd "$(dirname "$0")/../.."

version=$(node -p "require('./package.json').version")
npx electron-builder --linux dir --publish never

top=$(mktemp -d)
rpmbuild -bb packaging/rpm/simon-twitch.spec \
  --define "_topdir $top" \
  --define "app_version $version" \
  --define "app_dir $PWD/dist/linux-unpacked" \
  --define "app_icon $PWD/build/icon.png" \
  --define "app_desktop $PWD/packaging/rpm/simon-twitch.desktop"

cp "$top"/RPMS/x86_64/simon-twitch-*.rpm dist/Simon-Twitch.rpm
rm -rf "$top"
echo "Fertig: dist/Simon-Twitch.rpm"
