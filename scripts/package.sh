#!/bin/sh
# Builds the voice helper, packages the app, and re-signs it (ad-hoc) so macOS can
# remember its microphone / speech permissions.
set -e
cd "$(dirname "$0")/.."
sh scripts/build-listener.sh
env -u ELECTRON_RUN_AS_NODE npx electron-packager . "Ms. Minutes" --platform=darwin --out=dist --overwrite \
  --extend-info=build/extend-info.plist \
  --extra-resource=build/bin/minutes-listener \
  --ignore="^/(dist|assets|scripts|native|build/bin|.*\.zip)"
APP=$(ls -d dist/Ms.\ Minutes-darwin-*/Ms.\ Minutes.app | head -1)
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "packaged + signed: $APP"
