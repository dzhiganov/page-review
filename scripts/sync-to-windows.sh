#!/usr/bin/env bash
# Copies the extension to a Windows folder, for when Chrome on Windows refuses to
# "Load unpacked" from \\wsl.localhost\... After syncing, hit reload on chrome://extensions.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
win_user="$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')"
dest="${1:-/mnt/c/Users/${win_user}/page-review-extension}"
mkdir -p "$dest"
rsync -a --delete "$src/extension/" "$dest/"
echo "Synced to $dest"
echo "Windows path: $(wslpath -w "$dest")"
