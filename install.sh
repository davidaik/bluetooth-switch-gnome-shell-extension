#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Install this GNOME Shell extension locally (development install).

Usage:
  ./install.sh [--enable] [--disable] [--reinstall]

Options:
  --enable     Enable the extension after installing
  --disable    Disable the extension after installing
  --reinstall  Remove the existing target directory first

Notes:
  - GNOME Shell requires the extension directory name to match the UUID.
  - On Wayland you typically need to log out/in (or restart) for changes to load.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENABLE=false
DISABLE=false
REINSTALL=false

for arg in "$@"; do
	case "$arg" in
		-h|--help)
			usage
			exit 0
			;;
		--enable)
			ENABLE=true
			;;
		--disable)
			DISABLE=true
			;;
		--reinstall)
			REINSTALL=true
			;;
		*)
			echo "Unknown argument: $arg" >&2
			usage >&2
			exit 2
			;;
	esac
done

if [[ ! -f "$SCRIPT_DIR/metadata.json" ]]; then
	echo "metadata.json not found next to install.sh" >&2
	exit 1
fi

UUID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],"r",encoding="utf-8"))["uuid"])' "$SCRIPT_DIR/metadata.json")"

TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Installing $UUID -> $TARGET_DIR"

mkdir -p "$(dirname "$TARGET_DIR")"

if [[ "$REINSTALL" == "true" ]] && [[ -d "$TARGET_DIR" ]]; then
	rm -rf "$TARGET_DIR"
fi

# Copy extension files. Avoid copying development artifacts if present.
if command -v rsync >/dev/null 2>&1; then
	rsync -a --delete \
		--exclude '.git/' \
		--exclude '.DS_Store' \
		--exclude 'node_modules/' \
		--exclude 'install.sh' \
		--exclude '*.tsbuildinfo' \
		"$SCRIPT_DIR/" "$TARGET_DIR/"
else
	rm -rf "$TARGET_DIR"
	mkdir -p "$TARGET_DIR"
	cp -a "$SCRIPT_DIR/." "$TARGET_DIR/"
	rm -f "$TARGET_DIR/install.sh"
fi

if command -v gnome-extensions >/dev/null 2>&1; then
	if [[ "$DISABLE" == "true" ]]; then
		echo "Disabling extension: $UUID"
		gnome-extensions disable "$UUID" || true
	fi
	if [[ "$ENABLE" == "true" ]]; then
		echo "Enabling extension: $UUID"
		gnome-extensions enable "$UUID" || true
	fi
else
	echo "Note: gnome-extensions command not found; install completed without enabling/disabling." >&2
fi

cat <<EOF

Done.

If GNOME Shell doesn't pick up the changes:
  - On X11: press Alt+F2, type 'r', press Enter
  - On Wayland: log out and log back in

UUID: $UUID
Path: $TARGET_DIR
EOF
