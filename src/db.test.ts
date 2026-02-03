import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs, { Database } from "sql.js";
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
 * Test helper that wraps raw SQL operations matching DbService interface.
 * This allows testing database logic without Obsidian dependencies.
 */
class TestDb {
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

  getFileById(id: string): FileRecord | null {
    const stmt = this.db.prepare("SELECT * FROM files WHERE id = ?");
    stmt.bind([id]);
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

    if (updates.path !== undefined) {
      setClauses.push("path = ?");
      values.push(updates.path);
    }
    if (updates.deleted_at !== undefined) {
      setClauses.push("deleted_at = ?");
      values.push(updates.deleted_at);
    }
    if (updates.updated_at !== undefined) {
      setClauses.push("updated_at = ?");
      values.push(updates.updated_at);
    }

    if (setClauses.length === 0) return;

    values.push(id);
    this.db.run(`UPDATE files SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }

  getLatestVersion(fileId: string): VersionRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM versions WHERE file_id = ? ORDER BY version_num DESC LIMIT 1"
    );
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

  getVersion(fileId: string, versionNum: number): VersionRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM versions WHERE file_id = ? AND version_num = ?"
    );
    stmt.bind([fileId, versionNum]);
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

  insertVersion(version: VersionRecord): void {
    this.db.run(
      "INSERT INTO versions (id, file_id, version_num, is_checkpoint, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        version.id,
        version.file_id,
        version.version_num,
        version.is_checkpoint ? 1 : 0,
        version.data,
        version.created_at,
      ]
    );
  }

  getVersionCount(fileId: string): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM versions WHERE file_id = ?");
    stmt.bind([fileId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return row.count as number;
    }
    stmt.free();
    return 0;
  }
}

describe("DbService", () => {
  let db: TestDb;
  let rawDb: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    rawDb = new SQL.Database();
    rawDb.run(SCHEMA);
    db = new TestDb(rawDb);
  });

  describe("File operations", () => {
    it("inserts and retrieves a file by path", () => {
      const file: FileRecord = {
        id: "file-1",
        path: "notes/test.md",
        deleted_at: null,
        created_at: 1000,
        updated_at: 1000,
      };

      db.insertFile(file);
      const retrieved = db.getFileByPath("notes/test.md");

      expect(retrieved).toEqual(file);
    });

    it("retrieves a file by id", () => {
      const file: FileRecord = {
        id: "file-1",
        path: "notes/test.md",
        deleted_at: null,
        created_at: 1000,
        updated_at: 1000,
      };

      db.insertFile(file);
      const retrieved = db.getFileById("file-1");

      expect(retrieved).toEqual(file);
    });

    it("returns null for non-existent file", () => {
      expect(db.getFileByPath("nonexistent.md")).toBeNull();
      expect(db.getFileById("nonexistent")).toBeNull();
    });

    it("gets all files", () => {
      db.insertFile({ id: "1", path: "a.md", deleted_at: null, created_at: 1000, updated_at: 1000 });
      db.insertFile({ id: "2", path: "b.md", deleted_at: null, created_at: 1001, updated_at: 1001 });
      db.insertFile({ id: "3", path: "c.md", deleted_at: 2000, created_at: 1002, updated_at: 2000 });

      const files = db.getAllFiles();
      expect(files).toHaveLength(3);
    });

    it("updates file path", () => {
      db.insertFile({ id: "1", path: "old.md", deleted_at: null, created_at: 1000, updated_at: 1000 });

      db.updateFile("1", { path: "new.md", updated_at: 2000 });

      const file = db.getFileById("1");
      expect(file?.path).toBe("new.md");
      expect(file?.updated_at).toBe(2000);
    });

    it("marks file as deleted", () => {
      db.insertFile({ id: "1", path: "test.md", deleted_at: null, created_at: 1000, updated_at: 1000 });

      db.updateFile("1", { deleted_at: 5000, updated_at: 5000 });

      const file = db.getFileById("1");
      expect(file?.deleted_at).toBe(5000);
    });
  });

  describe("Version operations", () => {
    beforeEach(() => {
      db.insertFile({ id: "file-1", path: "test.md", deleted_at: null, created_at: 1000, updated_at: 1000 });
    });

    it("inserts and retrieves a version", () => {
      const version: VersionRecord = {
        id: "v1",
        file_id: "file-1",
        version_num: 1,
        is_checkpoint: true,
        data: "Hello World",
        created_at: 1000,
      };

      db.insertVersion(version);
      const retrieved = db.getVersion("file-1", 1);

      expect(retrieved).toEqual(version);
    });

    it("gets latest version", () => {
      db.insertVersion({ id: "v1", file_id: "file-1", version_num: 1, is_checkpoint: true, data: "v1", created_at: 1000 });
      db.insertVersion({ id: "v2", file_id: "file-1", version_num: 2, is_checkpoint: false, data: "v2", created_at: 2000 });
      db.insertVersion({ id: "v3", file_id: "file-1", version_num: 3, is_checkpoint: false, data: "v3", created_at: 3000 });

      const latest = db.getLatestVersion("file-1");

      expect(latest?.version_num).toBe(3);
      expect(latest?.data).toBe("v3");
    });

    it("gets versions in range", () => {
      for (let i = 1; i <= 10; i++) {
        db.insertVersion({
          id: `v${i}`,
          file_id: "file-1",
          version_num: i,
          is_checkpoint: i % 5 === 1,
          data: `content-${i}`,
          created_at: i * 1000,
        });
      }

      const versions = db.getVersionsInRange("file-1", 3, 7);

      expect(versions).toHaveLength(5);
      expect(versions[0]?.version_num).toBe(3);
      expect(versions[4]?.version_num).toBe(7);
    });

    it("gets nearest checkpoint before version", () => {
      db.insertVersion({ id: "v1", file_id: "file-1", version_num: 1, is_checkpoint: true, data: "cp1", created_at: 1000 });
      db.insertVersion({ id: "v2", file_id: "file-1", version_num: 2, is_checkpoint: false, data: "d2", created_at: 2000 });
      db.insertVersion({ id: "v3", file_id: "file-1", version_num: 3, is_checkpoint: false, data: "d3", created_at: 3000 });
      db.insertVersion({ id: "v4", file_id: "file-1", version_num: 4, is_checkpoint: false, data: "d4", created_at: 4000 });
      db.insertVersion({ id: "v5", file_id: "file-1", version_num: 5, is_checkpoint: true, data: "cp5", created_at: 5000 });
      db.insertVersion({ id: "v6", file_id: "file-1", version_num: 6, is_checkpoint: false, data: "d6", created_at: 6000 });

      // Nearest checkpoint to v4 should be v1
      expect(db.getNearestCheckpoint("file-1", 4)?.version_num).toBe(1);

      // Nearest checkpoint to v6 should be v5
      expect(db.getNearestCheckpoint("file-1", 6)?.version_num).toBe(5);

      // Nearest checkpoint to v5 should be v5 itself
      expect(db.getNearestCheckpoint("file-1", 5)?.version_num).toBe(5);
    });

    it("counts versions for a file", () => {
      expect(db.getVersionCount("file-1")).toBe(0);

      db.insertVersion({ id: "v1", file_id: "file-1", version_num: 1, is_checkpoint: true, data: "v1", created_at: 1000 });
      db.insertVersion({ id: "v2", file_id: "file-1", version_num: 2, is_checkpoint: false, data: "v2", created_at: 2000 });

      expect(db.getVersionCount("file-1")).toBe(2);
    });

    it("returns null for non-existent version", () => {
      expect(db.getVersion("file-1", 999)).toBeNull();
      expect(db.getLatestVersion("nonexistent-file")).toBeNull();
      expect(db.getNearestCheckpoint("file-1", 1)).toBeNull();
    });
  });
});
