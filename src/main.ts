import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, ObsyncSettings, ObsyncSettingTab } from "./settings";
import { DbService } from "./db";
import HistoryService from "./history";
import { logger } from "./utils/logger";
import { Level, field } from "@coder/logger";
import HistoryModal from "./ui/HistoryModal";

export default class Obsync extends Plugin {
  settings: ObsyncSettings;
  private db: DbService;
  private history: HistoryService;
  private snapshotDaemonInterval: number | null = null;

  async onload() {
    await this.loadSettings();

    // Set debug mode from settings
    logger.level = this.settings.debugMode ? Level.Debug : Level.Error;
    logger.info("Obsync plugin loading...", field("context", "Plugin"));

    // Initialize database
    logger.debug("Initializing database service", field("context", "Plugin"));
    this.db = new DbService(this);
    await this.db.init();

    // Initialize history service
    logger.debug("Initializing history service", field("context", "Plugin"));
    this.history = new HistoryService(this.db, this.app.vault);

    // Run startup scan
    logger.debug("Starting initial vault scan", field("context", "Plugin"));
    await this.startupScan();

    // Start snapshot daemon
    this.startSnapshotDaemon();

    // Register file modify listener
    logger.debug("Registering file modify listener", field("context", "Plugin"));
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          logger.debug(`File modified: ${file.path}`, field("context", "FileEvent"));
          await this.onFileModify(file);
        }
      })
    );

    // Register file delete listener
    logger.debug("Registering file delete listener", field("context", "Plugin"));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          logger.debug(`File deleted: ${file.path}`, field("context", "FileEvent"));
          this.history.markDeleted(file.path);
          this.db.save();
        }
      })
    );

    // Register file rename listener
    logger.debug("Registering file rename listener", field("context", "Plugin"));
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          logger.debug(`File renamed: ${oldPath} -> ${file.path}`, field("context", "FileEvent"));
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

    // Register commands
    this.addCommand({
      id: "obsync-show-version-history",
      name: "Show version history for current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const isMarkdown = file instanceof TFile && file.extension === "md";
        if (checking) {
          return isMarkdown;
        }
        if (file && isMarkdown) {
          this.openHistoryModal(file);
          return true;
        }
        return false;
      },
    });

    // Register file menu item
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle("Obsync history")
              .setIcon("history")
              .onClick(() => this.openHistoryModal(file));
          });
        }
      })
    );

    // Status bar showing tracking status
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText("Obsync: Active");

    logger.info("Obsync plugin loaded successfully", field("context", "Plugin"));
  }

  async onunload() {
    logger.info("Obsync plugin unloading...", field("context", "Plugin"));
    this.stopSnapshotDaemon();
    if (this.db) {
      logger.debug("Closing database", field("context", "Plugin"));
      await this.db.close();
    }
    logger.info("Obsync plugin unloaded", field("context", "Plugin"));
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<ObsyncSettings>
    );
    logger.debug("Settings loaded", field("context", "Settings"), field("settings", this.settings));
  }

  async saveSettings() {
    logger.debug("Saving settings", field("context", "Settings"), field("settings", this.settings));
    await this.saveData(this.settings);
    // Update debug mode
    logger.level = this.settings.debugMode ? Level.Debug : Level.Info;
    // Restart snapshot daemon if interval changed
    if (this.history) {
      this.restartSnapshotDaemon();
    }
  }

  private startSnapshotDaemon(): void {
    logger.debug("Starting snapshot daemon", field("context", "Plugin"), field("intervalMinutes", this.settings.snapshotIntervalMinutes));
    // Run immediately on startup
    this.history.runSnapshotDaemon();

    // Then run on interval
    const intervalMs = this.settings.snapshotIntervalMinutes * 60 * 1000;
    this.snapshotDaemonInterval = window.setInterval(() => {
      this.history.runSnapshotDaemon();
    }, intervalMs);
  }

  private stopSnapshotDaemon(): void {
    if (this.snapshotDaemonInterval !== null) {
      logger.debug("Stopping snapshot daemon", field("context", "Plugin"));
      window.clearInterval(this.snapshotDaemonInterval);
      this.snapshotDaemonInterval = null;
    }
  }

  private restartSnapshotDaemon(): void {
    this.stopSnapshotDaemon();
    this.startSnapshotDaemon();
  }

  /**
   * Scan vault on startup to detect new, deleted, and externally modified files.
   */
  private async startupScan(): Promise<void> {
    logger.debug("Starting vault scan", field("context", "Scan"));
    const trackedFiles = this.history.getAllFiles();
    const trackedPaths = new Set(trackedFiles.map((f) => f.path));
    const vaultPaths = new Set<string>();
    logger.debug(`Tracked files: ${trackedFiles.length}`, field("context", "Scan"));

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
    logger.debug(`Found ${vaultPaths.size} markdown files in vault`, field("context", "Scan"));

    // Check for new or modified files
    for (const path of vaultPaths) {
      if (!trackedPaths.has(path)) {
        // New file - create initial checkpoint
        logger.debug(`New file detected: ${path}`, field("context", "Scan"));
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
            logger.debug(`External modification detected: ${path}`, field("context", "Scan"));
            await this.history.save(path, content);
          }
        }
      }
    }

    // Check for deleted files
    for (const tracked of trackedFiles) {
      if (!vaultPaths.has(tracked.path) && tracked.deleted_at === null) {
        logger.debug(`Deleted file detected: ${tracked.path}`, field("context", "Scan"));
        this.history.markDeleted(tracked.path);
      }
    }

    await this.db.save();
    logger.info(`Vault scan completed: ${vaultPaths.size} files`, field("context", "Scan"));
    new Notice(`Obsync: Scanned ${vaultPaths.size} files`);
  }

  /**
   * Handle file modification event.
   */
  private async onFileModify(file: TFile): Promise<void> {
    logger.debug(`Processing file modification: ${file.path}`, field("context", "FileModify"));
    const content = await this.app.vault.read(file);
    const hasChanged = await this.history.hasChanged(file.path, content);
    if (hasChanged) {
      logger.debug(`Content changed, saving new version: ${file.path}`, field("context", "FileModify"));
      await this.history.save(file.path, content);
    } else {
      logger.debug(`No content change detected: ${file.path}`, field("context", "FileModify"));
    }
  }

  private openHistoryModal(file: TFile): void {
    new HistoryModal(this.app, this.history, file).open();
  }
}
