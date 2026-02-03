import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, ObsyncSettings, ObsyncSettingTab } from "./settings";
import { DbService } from "./db";
import HistoryService from "./history";

export default class Obsync extends Plugin {
  settings: ObsyncSettings;
  private db: DbService;
  private history: HistoryService;

  async onload() {
    await this.loadSettings();

    // Initialize database
    this.db = new DbService(this);
    await this.db.init();

    // Initialize history service
    this.history = new HistoryService(
      this.db,
      this.app.vault,
      this.settings.checkpointInterval
    );

    // Run startup scan
    await this.startupScan();

    // Register file modify listener
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          await this.onFileModify(file);
        }
      })
    );

    // Register file delete listener
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.history.markDeleted(file.path);
          this.db.save();
        }
      })
    );

    // Register file rename listener
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          const fileRecord = this.history.getFile(oldPath);
          if (fileRecord) {
            this.db.updateFile(fileRecord.id, {
              path: file.path,
              updated_at: Date.now(),
            });
            await this.db.save();
          }
        }
      })
    );

    // Add settings tab
    this.addSettingTab(new ObsyncSettingTab(this.app, this));

    // Status bar showing tracking status
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText("Obsync: Active");

    console.log("Obsync plugin loaded");
  }

  async onunload() {
    if (this.db) {
      await this.db.close();
    }
    console.log("Obsync plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<ObsyncSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update history service with new checkpoint interval
    if (this.history) {
      this.history.setCheckpointInterval(this.settings.checkpointInterval);
    }
  }

  /**
   * Scan vault on startup to detect new, deleted, and externally modified files.
   */
  private async startupScan(): Promise<void> {
    const trackedFiles = this.history.getAllFiles();
    const trackedPaths = new Set(trackedFiles.map((f) => f.path));
    const vaultPaths = new Set<string>();

    // Collect all markdown files in vault
    const processFolder = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md") {
          vaultPaths.add(child.path);
        } else if (child instanceof TFolder) {
          processFolder(child);
        }
      }
    };
    processFolder(this.app.vault.getRoot());

    // Check for new or modified files
    for (const path of vaultPaths) {
      if (!trackedPaths.has(path)) {
        // New file - create initial checkpoint
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          await this.history.save(path, content);
        }
      } else {
        // Existing file - check if modified externally
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          const hasChanged = await this.history.hasChanged(path, content);
          if (hasChanged) {
            await this.history.save(path, content);
          }
        }
      }
    }

    // Check for deleted files
    for (const tracked of trackedFiles) {
      if (!vaultPaths.has(tracked.path) && tracked.deleted_at === null) {
        this.history.markDeleted(tracked.path);
      }
    }

    await this.db.save();
    new Notice(`Obsync: Scanned ${vaultPaths.size} files`);
  }

  /**
   * Handle file modification event.
   */
  private async onFileModify(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const hasChanged = await this.history.hasChanged(file.path, content);
    if (hasChanged) {
      await this.history.save(file.path, content);
    }
  }
}
