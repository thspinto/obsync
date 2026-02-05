import {App, PluginSettingTab, Setting} from "obsidian";
import Obsync from "./main";

export interface ObsyncSettings {
	snapshotIntervalMinutes: number;
	debugMode: boolean;
	// Sync settings
	serverUrl: string;
	accessToken: string;
	refreshToken: string;
	deviceId: string;
	vaultId: string;
}

export const DEFAULT_SETTINGS: ObsyncSettings = {
	snapshotIntervalMinutes: 10,
	debugMode: false,
	serverUrl: "",
	accessToken: "",
	refreshToken: "",
	deviceId: "",
	vaultId: "",
}

export class ObsyncSettingTab extends PluginSettingTab {
	plugin: Obsync;

	constructor(app: App, plugin: Obsync) {
		super(app, plugin);
		this.plugin = plugin;
		// Note: vaultId is managed by SyncService.ensureVaultExists() during sync
		// It gets set to the server-side vault ID, not the local vault name
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Snapshot interval (minutes)')
			.setDesc('How often to create snapshots for files with recent changes')
			.addText(text => text
				.setPlaceholder('10')
				.setValue(String(this.plugin.settings.snapshotIntervalMinutes))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.snapshotIntervalMinutes = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable detailed debug logging in the console (requires reload)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));

		// Sync settings section
		containerEl.createEl('h3', { text: 'Cloud Sync' });

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('URL of the Obsync sync server (leave empty to disable sync)')
			.addText(text => text
				.setPlaceholder('https://your-server.com')
				.setValue(this.plugin.settings.serverUrl)
				.onChange(async (value) => {
					this.plugin.settings.serverUrl = value.trim();
					await this.plugin.saveSettings();
				}));

		// Show login button if server URL is set but not logged in
		if (this.plugin.settings.serverUrl && !this.plugin.settings.accessToken) {
			new Setting(containerEl)
				.setName('Login')
				.setDesc('Authenticate with the sync server')
				.addButton(button => button
					.setButtonText('Login')
					.onClick(async () => {
						await this.plugin.initiateLogin();
					}));
		}

		// Show logout and vault selection if logged in
		if (this.plugin.settings.accessToken) {
			new Setting(containerEl)
				.setName('Logged in')
				.setDesc(`Device ID: ${this.plugin.settings.deviceId || 'Unknown'}`)
				.addButton(button => button
					.setButtonText('Logout')
					.onClick(async () => {
						this.plugin.settings.accessToken = "";
						this.plugin.settings.refreshToken = "";
						this.plugin.settings.deviceId = "";
						this.plugin.settings.vaultId = "";
						await this.plugin.saveSettings();
						this.display(); // Refresh UI
					}));
		}
	}
}
