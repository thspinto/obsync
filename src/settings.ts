import {App, PluginSettingTab, Setting} from "obsidian";
import Obsync from "./main";

export interface ObsyncSettings {
	snapshotIntervalMinutes: number;
	debugMode: boolean;
}

export const DEFAULT_SETTINGS: ObsyncSettings = {
	snapshotIntervalMinutes: 10,
	debugMode: false
}

export class ObsyncSettingTab extends PluginSettingTab {
	plugin: Obsync;

	constructor(app: App, plugin: Obsync) {
		super(app, plugin);
		this.plugin = plugin;
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
	}
}
