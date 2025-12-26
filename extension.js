import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_A2DP_PROFILE = 'a2dp-sink';
const DEFAULT_HEADSET_PROFILE = 'headset-head-unit';

function delayMs(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function _trimOrEmpty(value) {
    if (typeof value !== 'string')
        return '';
    return value.trim();
}

function _notifyError(title, message) {
    try {
        Main.notifyError(title, message);
    } catch {
        Main.notify(`${title}: ${message}`);
    }
}

async function runCommand(argv) {
    const subprocess = Gio.Subprocess.new(
        argv,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );

    return await new Promise((resolve, reject) => {
        subprocess.communicate_utf8_async(null, null, (proc, res) => {
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                resolve({
                    ok: proc.get_successful(),
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                    status: proc.get_exit_status(),
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function runPactl(args) {
    const argv = ['pactl', ...args];
    try {
        const result = await runCommand(argv);
        return result;
    } catch (error) {
        return {
            ok: false,
            stdout: '',
            stderr: String(error),
            status: -1,
        };
    }
}

function parseCardsShort(output) {
    const cards = [];
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2)
            continue;
        cards.push(parts[1]);
    }
    return cards;
}

async function discoverBluetoothCards() {
    const result = await runPactl(['list', 'cards', 'short']);
    if (!result.ok)
        return {cards: [], error: _trimOrEmpty(result.stderr) || 'Failed to list cards'};

    const allCards = parseCardsShort(result.stdout);
    const btCards = allCards.filter(name => name.startsWith('bluez_card.'));
    return {cards: btCards, error: ''};
}

async function getActiveProfile(cardName) {
    const result = await runPactl(['list', 'cards']);
    if (!result.ok)
        return {profile: '', error: _trimOrEmpty(result.stderr) || 'Failed to read active profile'};

    const lines = result.stdout.split('\n');
    const needle = `Name: ${cardName}`;

    let inCard = false;
    for (const line of lines) {
        if (line.startsWith('Card #')) {
            inCard = false;
            continue;
        }

        if (line.trim() === needle) {
            inCard = true;
            continue;
        }

        if (!inCard)
            continue;

        const trimmed = line.trim();
        if (trimmed.startsWith('Active Profile:')) {
            const profile = trimmed.replace('Active Profile:', '').trim();
            return {profile, error: ''};
        }
    }

    return {profile: '', error: 'Active profile not found for selected card'};
}

async function setCardProfile(cardName, profile) {
    return await runPactl(['set-card-profile', cardName, profile]);
}

const BluetoothProfileIndicator = GObject.registerClass(
class BluetoothProfileIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Bluetooth Switch');

        this._extension = extension;
        this._busy = false;
        this._ignoreToggle = false;
        this._destroyed = false;
        this._pollId = 0;

        this._icon = new St.Icon({
            icon_name: 'bluetooth-active-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._switchBaseLabel = 'Headset mode';
        this._switchItem = new PopupMenu.PopupSwitchMenuItem(this._switchBaseLabel, false);

        this.menu.addMenuItem(this._switchItem);

        this._switchSignalId = this._switchItem.connect('toggled', async (_item, state) => {
            if (this._ignoreToggle)
                return;
            await this._onToggle(state);
        });

        void this._syncState();

        // Bluetooth cards can appear after the extension has already initialized.
        // Polling keeps the UI state accurate without requiring a shell restart.
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;

            void this._syncState();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        this._destroyed = true;

        if (this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = 0;
        }

        if (this._switchSignalId) {
            this._switchItem.disconnect(this._switchSignalId);
            this._switchSignalId = 0;
        }

        this._extension = null;

        super.destroy();
    }

    _setSwitchLabel(detail) {
        const suffix = _trimOrEmpty(detail);
        const text = suffix ? `${this._switchBaseLabel} — ${suffix}` : this._switchBaseLabel;

        if (this._switchItem?.label)
            this._switchItem.label.text = text;
    }

    _getProfiles() {
        return {a2dp: DEFAULT_A2DP_PROFILE, headset: DEFAULT_HEADSET_PROFILE};
    }

    async _getTargetCardName() {
        const {cards, error} = await discoverBluetoothCards();
        if (error)
            return {cardName: '', error};
        if (cards.length === 0)
            return {cardName: '', error: 'No Bluetooth audio cards found'};

        const sorted = [...cards].sort();
        return {cardName: sorted[0], error: ''};
    }

    async _syncState() {
        if (this._busy || this._destroyed)
            return;

        const {a2dp, headset} = this._getProfiles();
        const {cardName, error: cardError} = await this._getTargetCardName();

        // If a toggle started while we were awaiting, don't overwrite UI state.
        if (this._busy || this._destroyed)
            return;

        if (cardError) {
            this._setSwitchLabel(cardError);
            this._switchItem.setSensitive(false);
            return;
        }

        this._switchItem.setSensitive(true);
        this._setSwitchLabel('');

        const {profile, error: profileError} = await getActiveProfile(cardName);

        // If a toggle started while we were awaiting, don't overwrite UI state.
        if (this._busy || this._destroyed)
            return;

        if (profileError) {
            this._setSwitchLabel(`${cardName}: ${profileError}`);
            this._switchItem.setSensitive(false);
            return;
        }

        // Some audio stacks expose variant profile names like "headset-head-unit-msbc".
        const isHeadset = profile === headset || profile.startsWith(headset);
        this._ignoreToggle = true;
        this._switchItem.setToggleState(isHeadset);
        this._ignoreToggle = false;
    }

    async _onToggle(enabled) {
        if (this._busy)
            return;

        if (this._destroyed)
            return;

        this._busy = true;
        this._switchItem.setSensitive(false);

        try {
            const {a2dp, headset} = this._getProfiles();
            const {cardName, error: cardError} = await this._getTargetCardName();

            if (cardError) {
                _notifyError('Bluetooth Switch', cardError);
                return;
            }

            const targetProfile = enabled ? headset : a2dp;
            const result = await setCardProfile(cardName, targetProfile);

            if (this._destroyed)
                return;

            if (!result.ok) {
                const details = _trimOrEmpty(result.stderr) || _trimOrEmpty(result.stdout) || 'Unknown error';
                _notifyError('Bluetooth Switch', details);
                return;
            }

            Main.notify(`Bluetooth audio: ${enabled ? 'Headset' : 'A2DP'}`);
        } finally {
            this._busy = false;

            if (this._destroyed)
                return;

            this._switchItem.setSensitive(true);

            // Give the audio stack a moment to update "Active Profile" before syncing.
            await delayMs(250);
            if (!this._destroyed)
                void this._syncState();
        }
    }
});

export default class BluetoothSwitchExtension extends Extension {
    enable() {
        this._indicator = new BluetoothProfileIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
