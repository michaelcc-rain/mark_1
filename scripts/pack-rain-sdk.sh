#!/usr/bin/env bash
# Build ../rain-sdk-react, pack @rainxyz/{core,turnkey,wallet,react} into vendor/,
# point package.json (dependencies) and pnpm-workspace.yaml (overrides) at the new
# tarballs, and reinstall. The overrides make the tarballs' internal @rainxyz/* requirements
# resolve locally instead of from npm (where they 404).
#
# The packages are not on npm yet. Tarball names carry a content hash so every repack is a
# new file: specifier — pnpm treats a changed tarball under the same name as an integrity
# error that --force does not bypass.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="${RAIN_SDK_DIR:-$APP_DIR/../rain-sdk-react}"
VENDOR="$APP_DIR/vendor"
# rain-sdk-react pins pnpm@12.9.1 via packageManager. corepack 0.34 cannot launch pnpm 12
# (it expects bin/pnpm.cjs, which pnpm 12 no longer ships), so run the pinned version via npx.
SDK_PNPM="${SDK_PNPM:-npx -y pnpm@12.9.1}"

# "<npm name>|<workspace dir>|<tarball basename>"  (no bash-4 assoc arrays: macOS ships 3.2)
PKGS=(
  "@rainxyz/core|rain-core-web|rainxyz-core"
  "@rainxyz/turnkey|rain-turnkey-web|rainxyz-turnkey"
  "@rainxyz/wallet|rain-wallet-web|rainxyz-wallet"
  "@rainxyz/react|rain-react|rainxyz-react"
)

echo "==> Installing + building SDK in $SDK_DIR"
( cd "$SDK_DIR" && $SDK_PNPM install --frozen-lockfile && $SDK_PNPM build )

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$VENDOR"
rm -f "$VENDOR"/rainxyz-*.tgz

SPECS=()
for entry in "${PKGS[@]}"; do
  IFS='|' read -r name dir base <<<"$entry"
  # pack after build: files: ["dist"] means an unbuilt package packs to package.json only.
  ( cd "$SDK_DIR/$dir" && $SDK_PNPM pack --out "$TMP/$base.tgz" >/dev/null )
  hash="$(shasum -a 256 "$TMP/$base.tgz" | cut -c1-8)"
  mv "$TMP/$base.tgz" "$VENDOR/$base-$hash.tgz"
  SPECS+=("$name=file:vendor/$base-$hash.tgz")
  echo "    $name -> vendor/$base-$hash.tgz"
done

echo "==> Updating package.json + pnpm-workspace.yaml"
( cd "$APP_DIR" && node -e '
const fs = require("fs");
const specs = process.argv.slice(1).map((arg) => {
  const i = arg.indexOf("=");
  return [arg.slice(0, i), arg.slice(i + 1)];
});
// package.json: only the packages the app depends on directly.
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const [name, spec] of specs) {
  if (pkg.dependencies?.[name] !== undefined) pkg.dependencies[name] = spec;
}
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
// pnpm-workspace.yaml: pnpm >= 11 reads overrides from here, not package.json.
let ws = fs.readFileSync("pnpm-workspace.yaml", "utf8");
for (const [name, spec] of specs) {
  const line = `  "${name}": "${spec}"`;
  const re = new RegExp(`^  "${name.replace("/", "\\/")}": .*$`, "m");
  if (re.test(ws)) ws = ws.replace(re, line);
  else ws = ws.replace(/^overrides:\n/m, `overrides:\n${line}\n`);
}
fs.writeFileSync("pnpm-workspace.yaml", ws);
' "${SPECS[@]}" )

echo "==> pnpm install in $APP_DIR"
( cd "$APP_DIR" && pnpm install )
echo "Done."
