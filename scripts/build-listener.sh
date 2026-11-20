#!/bin/sh
# Compiles the native speech helper (Apple on-device speech recognition) to build/bin/minutes-listener.
set -e
cd "$(dirname "$0")/.."
mkdir -p build/bin
swiftc -O native/listener/main.swift -o build/bin/minutes-listener \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/listener/Info.plist
codesign --force --sign - --identifier com.msminutes.listener build/bin/minutes-listener
echo "built build/bin/minutes-listener"
