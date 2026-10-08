#!/usr/bin/env bash
# Builds Jobhunt for THIS Mac: a release Jobhunt.app, signed ad hoc (no Apple Developer ID), inside a dmg.
# It opens on the Mac that built it; another Mac needs right-click > Open (it is not notarized).
#
# Needs Node 22.5 or later and Rust (brew install rustup && rustup default stable).
# Output: dist/Jobhunt_<version>_<arch>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="$ROOT/.cache/cargo-target"
command -v cargo >/dev/null || { echo "Rust is missing: brew install rustup && rustup default stable" >&2; exit 1; }

TAURI_DIR="$ROOT/desktop/src-tauri"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
case "$TRIPLE" in
  aarch64-apple-darwin) NODE_ARCH=arm64 ;;
  x86_64-apple-darwin) NODE_ARCH=x64 ;;
  *) echo "This script builds on macOS only (found $TRIPLE)." >&2; exit 1 ;;
esac

echo "==> Node runtime to ship"
NODE_BIN="$TAURI_DIR/binaries/node-$TRIPLE"
if [ ! -x "$NODE_BIN" ]; then
  # The official build from nodejs.org, checked against its published SHA-256. A Homebrew node will not do: it
  # depends on libraries that are not on other Macs.
  NODE_VERSION="${JOBHUNT_NODE_VERSION:-v24.18.0}"
  NAME="node-$NODE_VERSION-darwin-$NODE_ARCH"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz" -o "$TMP/$NAME.tar.gz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  ( cd "$TMP" && grep " $NAME.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null )
  tar -xzf "$TMP/$NAME.tar.gz" -C "$TMP" "$NAME/bin/node"
  mkdir -p "$TAURI_DIR/binaries"
  cp "$TMP/$NAME/bin/node" "$NODE_BIN"
  rm -rf "$TMP"
fi

echo "==> Production build"
npm run build >/dev/null

echo "==> App tree (the standalone server, its static files, the data files)"
APP_TREE="$TAURI_DIR/resources/app"
rm -rf "$TAURI_DIR/resources"
mkdir -p "$APP_TREE"
# Only the server itself is taken. File tracing can sweep other project folders into the standalone tree (the
# database among them), and none of that belongs in the app.
for part in server.js package.json node_modules .next; do
  cp -R "$ROOT/.next/standalone/$part" "$APP_TREE/$part"
done
# Next links each external package into .next/node_modules under a hashed name. The bundler drops symbolic links,
# so each link becomes a real copy; the package's own dependencies still resolve from app/node_modules above it.
if [ -d "$APP_TREE/.next/node_modules" ]; then
  for link in "$APP_TREE/.next/node_modules"/*; do
    [ -L "$link" ] || continue
    target="$(cd "$link" && pwd -P)"
    rm "$link"
    cp -R "$target" "$link"
  done
fi
cp -R "$ROOT/.next/static" "$APP_TREE/.next/static"
[ -d "$ROOT/public" ] && cp -R "$ROOT/public" "$APP_TREE/public"
rm -rf "$APP_TREE/data"
cp -R "$ROOT/data" "$APP_TREE/data"
cp "$ROOT/desktop/launch.cjs" "$APP_TREE/launch.cjs"
# The Claude Desktop connector, run by the app's own Node.
cp -R "$ROOT/mcp" "$APP_TREE/mcp"

echo "==> Release app (the first build compiles the shell and takes a few minutes)"
( cd "$ROOT/desktop" && "$ROOT/node_modules/.bin/tauri" build --bundles app )
APP="$CARGO_TARGET_DIR/release/bundle/macos/Jobhunt.app"
[ -d "$APP" ] || { echo "No Jobhunt.app was produced." >&2; exit 1; }

echo "==> Ad hoc signature (inner binaries first, then the app)"
ENT="$TAURI_DIR/Entitlements.plist"
while IFS= read -r -d '' f; do
  if file -b "$f" | grep -q "Mach-O"; then codesign --force --sign - --entitlements "$ENT" "$f"; fi
done < <(find "$APP/Contents/Resources" "$APP/Contents/MacOS" -type f \( -name "*.node" -o -name "*.dylib" -o -name "node" -o -perm -u+x \) -print0)
codesign --force --sign - --entitlements "$ENT" "$APP"
codesign --verify --deep --strict "$APP"

VERSION="$(node -p "require('./desktop/src-tauri/tauri.conf.json').version")"
mkdir -p dist
DMG="dist/Jobhunt_${VERSION}_${NODE_ARCH}.dmg"
echo "==> $DMG"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/Jobhunt.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Jobhunt" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
hdiutil verify "$DMG" >/dev/null
echo "==> Chrome extension"
EXT_ZIP="dist/Jobhunt-extension_$(node -p "require('./extension/manifest.json').version").zip"
rm -f "$EXT_ZIP"
( cd "$ROOT" && zip -qr "$EXT_ZIP" extension -x "*.DS_Store" )
echo "Done: $DMG ($(du -h "$DMG" | cut -f1)) and $EXT_ZIP"
