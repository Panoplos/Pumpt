#!/bin/sh
# Builds the showcase on a Mac whose dyld rejects proc-macro dylibs that Apple's
# ld leaves with a 4-byte-aligned string pool (macOS 27 beta, Xcode 27). The
# build is run once, the proc-macro libraries it produced are realigned
# (tools/realign.py), and it is run again; any rustc wrapper from
# ~/.cargo/config.toml is bypassed, as a cached artifact would skip the fix.
#
#   sh tools/build.sh [cargo args...]        e.g. sh tools/build.sh --release
set -u
cd "$(dirname "$0")/.."
build() { cargo build --config 'build.rustc-wrapper=""' "$@"; }
if build "$@"; then exit 0; fi
echo "realigning proc-macro libraries..."
for f in target/release/deps/*.dylib target/debug/deps/*.dylib; do
  [ -f "$f" ] && python3 tools/realign.py "$f"
done
build "$@"
