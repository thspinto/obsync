import {App, PluginSettingTab, Setting} from "obsidian";
import Obsync from "./main";

export interface ObsyncSettings {
	checkpointInterval: number;
	debugMode: boolean;
}

export const DEFAULT_SETTINGS: ObsyncSettings = {
	checkpointInterval: 10,
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
			.setName('Checkpoint interval')
			.setDesc('Number of versions between full snapshots (lower = faster restore, more storage)')
			.addText(text => text
				.setPlaceholder('10')
				.setValue(String(this.plugin.settings.checkpointInterval))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.checkpointInterval = num;
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
