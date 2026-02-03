import { TFile, Vault } from "obsidian";
import { DiffMatchPatch } from "diff-match-patch-ts";
import { DbService, FileRecord, VersionRecord } from "./db";
import { uuidv7 } from "./utils/uuid";

export default class HistoryService {
  private db: DbService;
  private vault: Vault;
  private checkpointInterval: number;
  private dmp: DiffMatchPatch;

  constructor(db: DbService, vault: Vault, checkpointInterval: number) {
    this.db = db;
    this.vault = vault;
    this.checkpointInterval = checkpointInterval;
    this.dmp = new DiffMatchPatch();
  }

  setCheckpointInterval(interval: number): void {
    this.checkpointInterval = interval;
  }

  /**
   * Save a new version of a file.
   * Creates a diff from the last version, or a full checkpoint if needed.
   */
  async save(filePath: string, content: string): Promise<void> {
    const now = Date.now();

    // Get or create file record
    let file = this.db.getFileByPath(filePath);
    if (!file) {
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
        this.db.updateFile(file.id, { deleted_at: null, updated_at: now });
      }
    }

    // Get latest version
    const latestVersion = this.db.getLatestVersion(file.id);
    const nextVersionNum = latestVersion ? latestVersion.version_num + 1 : 1;

    // Determine if this should be a checkpoint
    const isCheckpoint = nextVersionNum === 1 || nextVersionNum % this.checkpointInterval === 0;

    let data: string;
    if (isCheckpoint) {
      // Store full content
      data = content;
    } else {
      // Compute and store diff from previous version
      const previousContent = await this.reconstructVersion(file.id, latestVersion!.version_num);
      if (previousContent === content) {
        // No actual change, skip
        return;
      }
      const patches = this.dmp.patch_make(previousContent, content);
      data = this.dmp.patch_toText(patches);
    }

    // Insert version record
    const version: VersionRecord = {
      id: uuidv7(),
      file_id: file.id,
      version_num: nextVersionNum,
      is_checkpoint: isCheckpoint,
      data: data,
      created_at: now,
    };
    this.db.insertVersion(version);

    // Update file timestamp
    this.db.updateFile(file.id, { updated_at: now });

    // Persist to disk
    await this.db.save();
  }

  /**
   * Reconstruct the content of a file at a specific version.
   */
  async reconstructVersion(fileId: string, targetVersion: number): Promise<string> {
    // Find the nearest checkpoint at or before target version
    const checkpoint = this.db.getNearestCheckpoint(fileId, targetVersion);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for file ${fileId} at or before version ${targetVersion}`);
    }

    // Start with checkpoint content
    let content = checkpoint.data;

    // Apply patches from checkpoint+1 to target
    if (checkpoint.version_num < targetVersion) {
      const versions = this.db.getVersionsInRange(fileId, checkpoint.version_num + 1, targetVersion);
      for (const version of versions) {
        if (!version.is_checkpoint) {
          const patches = this.dmp.patch_fromText(version.data);
          const [patchedContent, results] = this.dmp.patch_apply(patches, content);
          // Check if all patches applied successfully
          if (results.some((r) => !r)) {
            console.warn(`Some patches failed to apply for version ${version.version_num}`);
          }
          content = patchedContent;
        } else {
          // This shouldn't happen in normal flow, but handle it
          content = version.data;
        }
      }
    }

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
    const lastContent = await this.reconstructVersion(file.id, latestVersion.version_num);

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
   * Restore a file to a specific version.
   */
  async restore(filePath: string, targetVersion: number): Promise<void> {
    const file = this.db.getFileByPath(filePath);
    if (!file) {
      throw new Error(`File ${filePath} not found in history`);
    }

    const content = await this.reconstructVersion(file.id, targetVersion);

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
    return this.db.getVersionsInRange(file.id, 1, latestVersion.version_num);
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

    const lastContent = await this.reconstructVersion(file.id, latestVersion.version_num);
    return content !== lastContent;
  }
}
