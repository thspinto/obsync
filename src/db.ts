import initSqlJs, { Database } from "sql.js";
import { Plugin, requestUrl } from "obsidian";

// sql.js WASM hosted on CDN - using requestUrl for Obsidian compatibility
const SQL_WASM_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.wasm";

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

export interface FileRecord {
  id: string;
  path: string;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface VersionRecord {
  id: string;
  file_id: string;
  version_num: number;
  is_checkpoint: boolean;
  data: string;
  created_at: number;
}

export class DbService {
  private db: Database | null = null;
  private plugin: Plugin;
  private dbPath: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.dbPath = `${plugin.manifest.dir}/history.db`;
  }

  async init(): Promise<void> {
    // Fetch WASM binary using Obsidian's requestUrl to avoid CORS/fetch issues
    const wasmResponse = await requestUrl({ url: SQL_WASM_URL });
    const wasmBinary = wasmResponse.arrayBuffer;

    const SQL = await initSqlJs({
      wasmBinary,
    });

    // Try to load existing database
    const adapter = this.plugin.app.vault.adapter;
    if (await adapter.exists(this.dbPath)) {
      const data = await adapter.readBinary(this.dbPath);
      this.db = new SQL.Database(new Uint8Array(data));
    } else {
      this.db = new SQL.Database();
    }

    // Run migrations
    this.db.run(SCHEMA);
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.db) return;
    const data = this.db.export();
    await this.plugin.app.vault.adapter.writeBinary(this.dbPath, data);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.save();
      this.db.close();
      this.db = null;
    }
  }

  // File operations
  getFileByPath(path: string): FileRecord | null {
    if (!this.db) return null;
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
    if (!this.db) return null;
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
    if (!this.db) return [];
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
    if (!this.db) return;
    this.db.run(
      "INSERT INTO files (id, path, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [file.id, file.path, file.deleted_at, file.created_at, file.updated_at]
    );
  }

  updateFile(id: string, updates: Partial<Pick<FileRecord, "path" | "deleted_at" | "updated_at">>): void {
    if (!this.db) return;
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

  // Version operations
  getLatestVersion(fileId: string): VersionRecord | null {
    if (!this.db) return null;
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
    if (!this.db) return null;
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
    if (!this.db) return [];
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
    if (!this.db) return null;
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
    if (!this.db) return;
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
    if (!this.db) return 0;
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
