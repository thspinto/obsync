import { TFile, Vault } from "obsidian";
import { DiffMatchPatch } from "diff-match-patch-ts";
import { DbService, FileRecord, VersionRecord } from "./db";
import { uuidv7 } from "./utils/uuid";
import { logger } from "./utils/logger";
import { field } from "@coder/logger";

export default class HistoryService {
  private db: DbService;
  private vault: Vault;
  private dmp: DiffMatchPatch;

  constructor(db: DbService, vault: Vault) {
    this.db = db;
    this.vault = vault;
    this.dmp = new DiffMatchPatch();
  }

  /**
   * Save a new version of a file.
   * First version is always a snapshot, subsequent versions are diffs.
   */
  async save(filePath: string, content: string): Promise<void> {
    logger.debug(`Saving version for file: ${filePath}`,
      field("context", "History"),
      field("contentSize", content.length)
    );
    const now = Date.now();

    // Get or create file record
    let file = this.db.getFileByPath(filePath);
    if (!file) {
      logger.debug(`Creating new file record for: ${filePath}`, field("context", "History"));
      file = {
        id: uuidv7(),
        path: filePath,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      };
      this.db.insertFile(file);
    } else {
      // If file was marked as deleted, restore it
      if (file.deleted_at !== null) {
        logger.debug(`Restoring deleted file: ${filePath}`, field("context", "History"));
        this.db.updateFile(file.id, { deleted_at: null, updated_at: now });
      }
    }

    // Get latest version to determine if this is the first version
    const latestVersion = this.db.getLatestVersion(file.id);
    const isFirstVersion = !latestVersion;

    let data: string;
    if (isFirstVersion) {
      // First version is always a full snapshot
      logger.debug("Storing first version as snapshot", field("context", "History"));
      data = content;
    } else {
      // All subsequent versions are diffs
      const previousContent = await this.reconstructVersion(file.id, latestVersion.created_at);
      if (previousContent === content) {
        // No actual change, skip
        logger.debug("No content change detected, skipping version save", field("context", "History"));
        return;
      }
      logger.debug("Computing diff from previous version", field("context", "History"));
      const patches = this.dmp.patch_make(previousContent, content);
      data = this.dmp.patch_toText(patches);
      logger.debug(`Diff size: ${data.length} bytes`, field("context", "History"));
    }

    // Insert version record
    const version: VersionRecord = {
      id: uuidv7(),
      file_id: file.id,
      is_checkpoint: isFirstVersion,
      data: data,
      created_at: now,
    };
    this.db.insertVersion(version);

    // Update file timestamp
    this.db.updateFile(file.id, { updated_at: now });

    // Persist to disk
    await this.db.save();
    logger.info(`Version saved for ${filePath}`, field("context", "History"), field("is_snapshot", isFirstVersion));
  }

  /**
   * Reconstruct the content of a file at a specific timestamp.
   */
  async reconstructVersion(fileId: string, targetTimestamp: number): Promise<string> {
    logger.debug(`Reconstructing version at ${targetTimestamp} for file ${fileId}`, field("context", "History"));
    // Find the nearest checkpoint at or before target timestamp
    const checkpoint = this.db.getNearestCheckpoint(fileId, targetTimestamp);
    if (!checkpoint) {
      logger.error(`No checkpoint found for file ${fileId} at or before timestamp ${targetTimestamp}`, field("context", "History"));
      throw new Error(`No checkpoint found for file ${fileId} at or before timestamp ${targetTimestamp}`);
    }

    logger.debug(`Starting from checkpoint at ${checkpoint.created_at}`, field("context", "History"));
    // Start with checkpoint content
    let content = checkpoint.data;

    // Apply patches from checkpoint+1 to target
    if (checkpoint.created_at < targetTimestamp) {
      const versions = this.db.getVersionsInRange(fileId, checkpoint.created_at + 1, targetTimestamp);
      logger.debug(`Applying ${versions.length} patches`, field("context", "History"));
      for (const version of versions) {
        if (!version.is_checkpoint) {
          const patches = this.dmp.patch_fromText(version.data);
          const [patchedContent, results] = this.dmp.patch_apply(patches, content);
          // Check if all patches applied successfully
          if (results.some((r) => !r)) {
            logger.warn(`Some patches failed to apply at timestamp ${version.created_at}`, field("context", "History"));
          }
          content = patchedContent;
        } else {
          // This shouldn't happen in normal flow, but handle it
          logger.debug(`Using checkpoint at timestamp ${version.created_at}`, field("context", "History"));
          content = version.data;
        }
      }
    }

    logger.debug(`Version at ${targetTimestamp} reconstructed successfully`, field("context", "History"));
    return content;
  }

  /**
   * Get the diff between the current file content and the last saved version.
   */
  async diff(filePath: string): Promise<string> {
    const file = this.db.getFileByPath(filePath);
    if (!file) {
      return "File not tracked";
    }

    const latestVersion = this.db.getLatestVersion(file.id);
    if (!latestVersion) {
      return "No versions found";
    }

    const tfile = this.vault.getAbstractFileByPath(filePath);
    if (!(tfile instanceof TFile)) {
      return "File not found in vault";
    }

    const currentContent = await this.vault.read(tfile);
    const lastContent = await this.reconstructVersion(file.id, latestVersion.created_at);

    if (currentContent === lastContent) {
      return "No changes";
    }

    const diffs = this.dmp.diff_main(lastContent, currentContent);
    this.dmp.diff_cleanupSemantic(diffs);

    // Format diffs as readable text
    const lines: string[] = [];
    for (const [op, text] of diffs) {
      if (op === -1) {
        lines.push(`- ${text}`);
      } else if (op === 1) {
        lines.push(`+ ${text}`);
      }
    }

    return lines.length > 0 ? lines.join("\n") : "No changes";
  }

  /**
   * Restore a file to a specific timestamp.
   */
  async restore(filePath: string, targetTimestamp: number): Promise<void> {
    logger.info(`Restoring ${filePath} to timestamp ${targetTimestamp}`, field("context", "History"));
    const file = this.db.getFileByPath(filePath);
    if (!file) {
      logger.error(`File ${filePath} not found in history`, field("context", "History"));
      throw new Error(`File ${filePath} not found in history`);
    }

    const content = await this.reconstructVersion(file.id, targetTimestamp);

    // Get or create the file in vault
    const tfile = this.vault.getAbstractFileByPath(filePath);
    if (tfile instanceof TFile) {
      await this.vault.modify(tfile, content);
    } else {
      await this.vault.create(filePath, content);
    }

    // Clear deleted_at if set
    if (file.deleted_at !== null) {
      this.db.updateFile(file.id, { deleted_at: null, updated_at: Date.now() });
    }

    // Note: The modify event will fire and create a new version entry
  }

  /**
   * Mark a file as deleted in the database.
   */
  markDeleted(filePath: string): void {
    logger.debug(`Marking file as deleted: ${filePath}`, field("context", "History"));
    const file = this.db.getFileByPath(filePath);
    if (file && file.deleted_at === null) {
      this.db.updateFile(file.id, { deleted_at: Date.now(), updated_at: Date.now() });
    }
  }

  /**
   * Get all versions for a file.
   */
  getVersions(filePath: string): VersionRecord[] {
    const file = this.db.getFileByPath(filePath);
    if (!file) {
      return [];
    }
    const latestVersion = this.db.getLatestVersion(file.id);
    if (!latestVersion) {
      return [];
    }
    return this.db.getVersionsInRange(file.id, 0, latestVersion.created_at);
  }

  /**
   * Get file record by path.
   */
  getFile(filePath: string): FileRecord | null {
    return this.db.getFileByPath(filePath);
  }

  /**
   * Get all tracked files.
   */
  getAllFiles(): FileRecord[] {
    return this.db.getAllFiles();
  }

  /**
   * Check if content has changed from the last version.
   */
  async hasChanged(filePath: string, content: string): Promise<boolean> {
    const file = this.db.getFileByPath(filePath);
    if (!file) {
      return true; // New file
    }

    const latestVersion = this.db.getLatestVersion(file.id);
    if (!latestVersion) {
      return true; // No versions yet
    }

    const lastContent = await this.reconstructVersion(file.id, latestVersion.created_at);
    return content !== lastContent;
  }

  /**
   * Create a snapshot for a file if the latest version is not already a snapshot.
   * Deletes any previous daemon-created snapshots (keeps only the first version snapshot).
   */
  async createSnapshotIfNeeded(fileId: string): Promise<boolean> {
    const file = this.db.getFileById(fileId);
    if (!file || file.deleted_at !== null) {
      return false;
    }

    const latestVersion = this.db.getLatestVersion(fileId);
    if (!latestVersion) {
      return false;
    }

    // If latest version is already a snapshot, nothing to do
    if (latestVersion.is_checkpoint) {
      logger.debug(`Latest version is already a snapshot for file ${file.path}`, field("context", "SnapshotDaemon"));
      return false;
    }

    // Reconstruct current content
    const content = await this.reconstructVersion(fileId, latestVersion.created_at);

    // Create new snapshot
    const now = Date.now();
    const version: VersionRecord = {
      id: uuidv7(),
      file_id: fileId,
      is_checkpoint: true,
      data: content,
      created_at: now,
    };
    this.db.insertVersion(version);

    // Delete any previous daemon-created snapshots (keep first version + this new one)
    this.db.deleteNonFirstCheckpoints(fileId, version.id);

    // Update file timestamp
    this.db.updateFile(fileId, { updated_at: now });

    logger.info(`Snapshot created for ${file.path}`, field("context", "SnapshotDaemon"));
    return true;
  }

  /**
   * Run the snapshot daemon - creates snapshots for files where the latest version is not a snapshot.
   */
  async runSnapshotDaemon(): Promise<void> {
    logger.debug("Running snapshot daemon", field("context", "SnapshotDaemon"));
    const files = this.db.getAllFiles();
    let snapshotsCreated = 0;

    for (const file of files) {
      if (file.deleted_at !== null) {
        continue;
      }

      const created = await this.createSnapshotIfNeeded(file.id);
      if (created) {
        snapshotsCreated++;
      }
    }

    if (snapshotsCreated > 0) {
      await this.db.save();
      logger.info(`Snapshot daemon completed: ${snapshotsCreated} snapshots created`, field("context", "SnapshotDaemon"));
    } else {
      logger.debug("Snapshot daemon completed: no snapshots needed", field("context", "SnapshotDaemon"));
    }
  }
}
