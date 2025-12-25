GNOME Shell extension to switch Bluetooth audio profile (A2DP vs Headset).

It uses the following commands:

pactl set-card-profile bluez_card.9C_DE_F0_53_E2_6C a2dp-sink

pactl set-card-profile bluez_card.9C_DE_F0_53_E2_6C headset-head-unit

## UI

- A top-bar (panel) indicator with a single toggle: “Headset mode”.

## Behavior

- The extension automatically targets the first detected Bluetooth audio card (`bluez_card.*`, sorted).
- The menu label updates automatically when a Bluetooth card appears/disappears (may take a few seconds).

## Install (local development)

GNOME Shell requires the extension directory name to match the UUID. This project’s UUID is `bluetooth-switch@local`.

Quick install:

```sh
./install.sh --reinstall
```

1. Copy this folder to: `~/.local/share/gnome-shell/extensions/bluetooth-switch@local`
2. Restart GNOME Shell and enable the extension

Notes:
- This extension targets GNOME Shell 46.
- `pactl` must be available.

