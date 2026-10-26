#!/usr/bin/env bash
# Builds Jobhunt for Windows (x64; Windows on ARM runs it too) from this Mac: a folder with Jobhunt.exe, the app it
# runs, a short README and the Chrome extension, zipped. Jobhunt.exe is the official Node.js for Windows with
# desktop/windows/launcher.cjs built in (a Node single executable application). It is not code-signed, so Windows
# SmartScreen asks once ("More info" > "Run anyway").
#
# Needs Node 22.5 or later and a Mac build of the same Node version as the Windows one (the Mac build script fetches
# it; or set JOBHUNT_SEA_NODE to any Node of that version).
# Output: dist/Jobhunt-windows-x64_<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
NODE_VERSION="${JOBHUNT_NODE_VERSION:-v24.18.0}"
VERSION="$(node -p "require('./package.json').version")"
WORK="$ROOT/.cache/windows"
OUT="$WORK/Jobhunt"
mkdir -p "$WORK" dist

echo "==> Node $NODE_VERSION for Windows"
WIN_NAME="node-$NODE_VERSION-win-x64"
if [ ! -f "$WORK/$WIN_NAME/node.exe" ]; then
  # The official build from nodejs.org, checked against its published SHA-256.
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$WIN_NAME.zip" -o "$WORK/$WIN_NAME.zip"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
  ( cd "$WORK" && grep " $WIN_NAME.zip\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null )
  ( cd "$WORK" && unzip -q -o "$WIN_NAME.zip" "$WIN_NAME/node.exe" )
fi

# The blob that goes into Jobhunt.exe has to be made by the same Node version that will run it.
SEA_NODE="${JOBHUNT_SEA_NODE:-}"
if [ -z "$SEA_NODE" ]; then
  for c in "$ROOT"/desktop/src-tauri/binaries/node-*; do [ -x "$c" ] && SEA_NODE="$c" && break; done
fi
[ -n "$SEA_NODE" ] && [ "$("$SEA_NODE" -v)" = "$NODE_VERSION" ] || { echo "Need a Node $NODE_VERSION for this Mac: run npm run dmg once, or set JOBHUNT_SEA_NODE." >&2; exit 1; }

echo "==> Production build"
npm run build >/dev/null

echo "==> App tree"
rm -rf "$OUT"
mkdir -p "$OUT/app"
for part in server.js package.json node_modules .next; do cp -R "$ROOT/.next/standalone/$part" "$OUT/app/$part"; done
# Real copies in place of the links Next makes in .next/node_modules (zip and Windows do not keep them).
if [ -d "$OUT/app/.next/node_modules" ]; then
  for link in "$OUT/app/.next/node_modules"/*; do
    [ -L "$link" ] || continue
    target="$(cd "$link" && pwd -P)"
    rm "$link"
    cp -R "$target" "$link"
  done
fi
# Image resizing's native library is built for this Mac; Jobhunt does not resize images.
rm -rf "$OUT/app/node_modules/@img"
find "$OUT/app" -name "*.node" -print | grep . && { echo "A native module for this Mac is in the app tree; it would not load on Windows." >&2; exit 1; } || true
cp -R "$ROOT/.next/static" "$OUT/app/.next/static"
[ -d "$ROOT/public" ] && cp -R "$ROOT/public" "$OUT/app/public"
cp -R "$ROOT/data" "$OUT/app/data"
cp -R "$ROOT/mcp" "$OUT/app/mcp"
cp "$ROOT/desktop/upgrade.cjs" "$OUT/app/upgrade.cjs"

echo "==> Jobhunt.exe"
cat > "$WORK/sea-config.json" <<JSON
{ "main": "$ROOT/desktop/windows/launcher.cjs", "output": "$WORK/sea-prep.blob", "disableExperimentalSEAWarning": true, "useSnapshot": false, "useCodeCache": false }
JSON
"$SEA_NODE" --experimental-sea-config "$WORK/sea-config.json" >/dev/null
cp "$WORK/$WIN_NAME/node.exe" "$OUT/Jobhunt.exe"
# Node's own signature would no longer match once the launcher is added: it is taken off first.
node "$ROOT/scripts/strip-pe-signature.mjs" "$OUT/Jobhunt.exe"
"$ROOT/node_modules/.bin/postject" "$OUT/Jobhunt.exe" NODE_SEA_BLOB "$WORK/sea-prep.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null

echo "==> README and extension"
sed 's/$/\r/' "$ROOT/desktop/windows/README.txt" > "$OUT/README.txt"
( cd "$ROOT/extension" && rm -f "$OUT/Jobhunt-extension.zip" && zip -qr "$OUT/Jobhunt-extension.zip" . -x ".*" )

ZIP="$ROOT/dist/Jobhunt-windows-x64_$VERSION.zip"
rm -f "$ZIP"
( cd "$WORK" && zip -qr -9 "$ZIP" Jobhunt )
echo "Done: $ZIP ($(du -h "$ZIP" | cut -f1))"
