import { describe, it, expect, beforeEach, vi } from "vitest";
import initSqlJs, { Database } from "sql.js";
import { DiffMatchPatch } from "diff-match-patch-ts";
import { FileRecord, VersionRecord } from "./db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  version_num INTEGER NOT NULL,
  is_checkpoint INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(file_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_versions_file ON versions(file_id, version_num DESC);
`;

/**
 * In-memory database adapter for testing HistoryService logic.
 */
class TestDbAdapter {
  constructor(private db: Database) {}

  getFileByPath(path: string): FileRecord | null {
    const stmt = this.db.prepare("SELECT * FROM files WHERE path = ?");
    stmt.bind([path]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        path: row.path as string,
        deleted_at: row.deleted_at as number | null,
        created_at: row.created_at as number,
        updated_at: row.updated_at as number,
      };
    }
    stmt.free();
    return null;
  }

  getAllFiles(): FileRecord[] {
    const stmt = this.db.prepare("SELECT * FROM files");
    const files: FileRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      files.push({
        id: row.id as string,
        path: row.path as string,
        deleted_at: row.deleted_at as number | null,
        created_at: row.created_at as number,
        updated_at: row.updated_at as number,
      });
    }
    stmt.free();
    return files;
  }

  insertFile(file: FileRecord): void {
    this.db.run(
      "INSERT INTO files (id, path, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [file.id, file.path, file.deleted_at, file.created_at, file.updated_at]
    );
  }

  updateFile(id: string, updates: Partial<Pick<FileRecord, "path" | "deleted_at" | "updated_at">>): void {
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];
    if (updates.path !== undefined) { setClauses.push("path = ?"); values.push(updates.path); }
    if (updates.deleted_at !== undefined) { setClauses.push("deleted_at = ?"); values.push(updates.deleted_at); }
    if (updates.updated_at !== undefined) { setClauses.push("updated_at = ?"); values.push(updates.updated_at); }
    if (setClauses.length === 0) return;
    values.push(id);
    this.db.run(`UPDATE files SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }

  getLatestVersion(fileId: string): VersionRecord | null {
    const stmt = this.db.prepare("SELECT * FROM versions WHERE file_id = ? ORDER BY version_num DESC LIMIT 1");
    stmt.bind([fileId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        file_id: row.file_id as string,
        version_num: row.version_num as number,
        is_checkpoint: Boolean(row.is_checkpoint),
        data: row.data as string,
        created_at: row.created_at as number,
      };
    }
    stmt.free();
    return null;
  }

  getNearestCheckpoint(fileId: string, beforeVersion: number): VersionRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM versions WHERE file_id = ? AND version_num <= ? AND is_checkpoint = 1 ORDER BY version_num DESC LIMIT 1"
    );
    stmt.bind([fileId, beforeVersion]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        file_id: row.file_id as string,
        version_num: row.version_num as number,
        is_checkpoint: Boolean(row.is_checkpoint),
        data: row.data as string,
        created_at: row.created_at as number,
      };
    }
    stmt.free();
    return null;
  }

  getVersionsInRange(fileId: string, fromVersion: number, toVersion: number): VersionRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM versions WHERE file_id = ? AND version_num >= ? AND version_num <= ? ORDER BY version_num ASC"
    );
    stmt.bind([fileId, fromVersion, toVersion]);
    const versions: VersionRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      versions.push({
        id: row.id as string,
        file_id: row.file_id as string,
        version_num: row.version_num as number,
        is_checkpoint: Boolean(row.is_checkpoint),
        data: row.data as string,
        created_at: row.created_at as number,
      });
    }
    stmt.free();
    return versions;
  }

  insertVersion(version: VersionRecord): void {
    this.db.run(
      "INSERT INTO versions (id, file_id, version_num, is_checkpoint, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [version.id, version.file_id, version.version_num, version.is_checkpoint ? 1 : 0, version.data, version.created_at]
    );
  }

  async save(): Promise<void> {
    // No-op for in-memory testing
  }
}

/**
 * Simplified HistoryService for testing without Obsidian dependencies.
 */
class TestHistoryService {
  private dmp = new DiffMatchPatch();
  private idCounter = 0;

  constructor(
    private db: TestDbAdapter,
    private checkpointInterval: number
  ) {}

  private generateId(): string {
    return `test-id-${++this.idCounter}`;
  }

  async save(filePath: string, content: string): Promise<void> {
    const now = Date.now();

    let file = this.db.getFileByPath(filePath);
    if (!file) {
      file = {
        id: this.generateId(),
        path: filePath,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      };
      this.db.insertFile(file);
    } else if (file.deleted_at !== null) {
      this.db.updateFile(file.id, { deleted_at: null, updated_at: now });
    }

    const latestVersion = this.db.getLatestVersion(file.id);
    const nextVersionNum = latestVersion ? latestVersion.version_num + 1 : 1;
    const isCheckpoint = nextVersionNum === 1 || nextVersionNum % this.checkpointInterval === 0;

    let data: string;
    if (isCheckpoint) {
      data = content;
    } else {
      const previousContent = await this.reconstructVersion(file.id, latestVersion!.version_num);
      if (previousContent === content) {
        return; // No change
      }
      const patches = this.dmp.patch_make(previousContent, content);
      data = this.dmp.patch_toText(patches);
    }

    this.db.insertVersion({
      id: this.generateId(),
      file_id: file.id,
      version_num: nextVersionNum,
      is_checkpoint: isCheckpoint,
      data,
      created_at: now,
    });

    this.db.updateFile(file.id, { updated_at: now });
  }

  async reconstructVersion(fileId: string, targetVersion: number): Promise<string> {
    const checkpoint = this.db.getNearestCheckpoint(fileId, targetVersion);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for file ${fileId}`);
    }

    let content = checkpoint.data;

    if (checkpoint.version_num < targetVersion) {
      const versions = this.db.getVersionsInRange(fileId, checkpoint.version_num + 1, targetVersion);
      for (const version of versions) {
        if (!version.is_checkpoint) {
          const patches = this.dmp.patch_fromText(version.data);
          const [patchedContent] = this.dmp.patch_apply(patches, content);
          content = patchedContent;
        } else {
          content = version.data;
        }
      }
    }

    return content;
  }

  async hasChanged(filePath: string, content: string): Promise<boolean> {
    const file = this.db.getFileByPath(filePath);
    if (!file) return true;

    const latestVersion = this.db.getLatestVersion(file.id);
    if (!latestVersion) return true;

    const lastContent = await this.reconstructVersion(file.id, latestVersion.version_num);
    return content !== lastContent;
  }

  markDeleted(filePath: string): void {
    const file = this.db.getFileByPath(filePath);
    if (file && file.deleted_at === null) {
      this.db.updateFile(file.id, { deleted_at: Date.now(), updated_at: Date.now() });
    }
  }

  getFile(filePath: string): FileRecord | null {
    return this.db.getFileByPath(filePath);
  }

  getAllFiles(): FileRecord[] {
    return this.db.getAllFiles();
  }
}

describe("HistoryService", () => {
  let db: TestDbAdapter;
  let history: TestHistoryService;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    const rawDb = new SQL.Database();
    rawDb.run(SCHEMA);
    db = new TestDbAdapter(rawDb);
    history = new TestHistoryService(db, 5); // Checkpoint every 5 versions
  });

  describe("save", () => {
    it("creates initial checkpoint for new file", async () => {
      await history.save("test.md", "Hello World");

      const file = history.getFile("test.md");
      expect(file).not.toBeNull();

      const version = db.getLatestVersion(file!.id);
      expect(version?.version_num).toBe(1);
      expect(version?.is_checkpoint).toBe(true);
      expect(version?.data).toBe("Hello World");
    });

    it("stores diff for subsequent versions", async () => {
      await history.save("test.md", "Hello World");
      await history.save("test.md", "Hello Universe");

      const file = history.getFile("test.md");
      const version = db.getLatestVersion(file!.id);

      expect(version?.version_num).toBe(2);
      expect(version?.is_checkpoint).toBe(false);
      // Data should be a patch, not the full content
      expect(version?.data).not.toBe("Hello Universe");
      expect(version?.data).toContain("@"); // Patch format contains @
    });

    it("creates checkpoint at interval", async () => {
      // Checkpoint interval is 5, so versions 1, 5, 10... should be checkpoints
      await history.save("test.md", "v1");
      await history.save("test.md", "v2");
      await history.save("test.md", "v3");
      await history.save("test.md", "v4");
      await history.save("test.md", "v5"); // Should be checkpoint

      const file = history.getFile("test.md");
      const v1 = db.getNearestCheckpoint(file!.id, 1);
      const v5 = db.getNearestCheckpoint(file!.id, 5);

      expect(v1?.version_num).toBe(1);
      expect(v1?.is_checkpoint).toBe(true);
      expect(v5?.version_num).toBe(5);
      expect(v5?.is_checkpoint).toBe(true);
    });

    it("skips save if content unchanged", async () => {
      await history.save("test.md", "Same content");
      await history.save("test.md", "Same content");

      const file = history.getFile("test.md");
      const latest = db.getLatestVersion(file!.id);

      expect(latest?.version_num).toBe(1); // Only one version saved
    });

    it("restores file if previously deleted", async () => {
      await history.save("test.md", "Content");
      history.markDeleted("test.md");

      let file = history.getFile("test.md");
      expect(file?.deleted_at).not.toBeNull();

      await history.save("test.md", "New content");

      file = history.getFile("test.md");
      expect(file?.deleted_at).toBeNull();
    });
  });

  describe("reconstructVersion", () => {
    it("reconstructs version from checkpoint", async () => {
      await history.save("test.md", "Checkpoint content");

      const file = history.getFile("test.md");
      const content = await history.reconstructVersion(file!.id, 1);

      expect(content).toBe("Checkpoint content");
    });

    it("reconstructs version by applying patches", async () => {
      await history.save("test.md", "Line 1");
      await history.save("test.md", "Line 1\nLine 2");
      await history.save("test.md", "Line 1\nLine 2\nLine 3");

      const file = history.getFile("test.md");

      expect(await history.reconstructVersion(file!.id, 1)).toBe("Line 1");
      expect(await history.reconstructVersion(file!.id, 2)).toBe("Line 1\nLine 2");
      expect(await history.reconstructVersion(file!.id, 3)).toBe("Line 1\nLine 2\nLine 3");
    });

    it("reconstructs version across checkpoints", async () => {
      // Create 7 versions (checkpoints at 1 and 5)
      const contents = [
        "Version 1", "Version 2", "Version 3", "Version 4",
        "Version 5", "Version 6", "Version 7"
      ];

      for (const content of contents) {
        await history.save("test.md", content);
      }

      const file = history.getFile("test.md");

      // Version 7 should reconstruct from checkpoint 5 + patches 6, 7
      expect(await history.reconstructVersion(file!.id, 7)).toBe("Version 7");
      expect(await history.reconstructVersion(file!.id, 3)).toBe("Version 3");
    });
  });

  describe("hasChanged", () => {
    it("returns true for new file", async () => {
      expect(await history.hasChanged("new.md", "content")).toBe(true);
    });

    it("returns false for unchanged content", async () => {
      await history.save("test.md", "Original");
      expect(await history.hasChanged("test.md", "Original")).toBe(false);
    });

    it("returns true for changed content", async () => {
      await history.save("test.md", "Original");
      expect(await history.hasChanged("test.md", "Modified")).toBe(true);
    });
  });

  describe("markDeleted", () => {
    it("sets deleted_at timestamp", async () => {
      await history.save("test.md", "Content");
      history.markDeleted("test.md");

      const file = history.getFile("test.md");
      expect(file?.deleted_at).not.toBeNull();
    });

    it("preserves history after deletion", async () => {
      await history.save("test.md", "v1");
      await history.save("test.md", "v2");
      history.markDeleted("test.md");

      const file = history.getFile("test.md");
      const content = await history.reconstructVersion(file!.id, 2);

      expect(content).toBe("v2");
    });

    it("does nothing for non-existent file", () => {
      // Should not throw
      history.markDeleted("nonexistent.md");
    });
  });

  describe("complex editing scenarios", () => {
    it("handles real-world editing pattern", async () => {
      // Simulate typical note editing
      await history.save("note.md", "# My Note\n\nFirst draft.");
      await history.save("note.md", "# My Note\n\nFirst draft.\n\n## Section 1\nSome content.");
      await history.save("note.md", "# My Note\n\nRevised intro.\n\n## Section 1\nSome content.");
      await history.save("note.md", "# My Note\n\nRevised intro.\n\n## Section 1\nSome content.\n\n## Section 2\nMore content.");

      const file = history.getFile("note.md");
      const finalContent = await history.reconstructVersion(file!.id, 4);

      expect(finalContent).toBe("# My Note\n\nRevised intro.\n\n## Section 1\nSome content.\n\n## Section 2\nMore content.");
    });

    it("handles large text changes", async () => {
      const shortContent = "Short";
      const longContent = "A".repeat(10000);

      await history.save("test.md", shortContent);
      await history.save("test.md", longContent);
      await history.save("test.md", shortContent);

      const file = history.getFile("test.md");

      expect(await history.reconstructVersion(file!.id, 1)).toBe(shortContent);
      expect(await history.reconstructVersion(file!.id, 2)).toBe(longContent);
      expect(await history.reconstructVersion(file!.id, 3)).toBe(shortContent);
    });
  });
});
