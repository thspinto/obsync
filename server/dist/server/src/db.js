import Database from "better-sqlite3";
import { config } from "./config.js";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id),
  path TEXT NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(vault_id, path)
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  is_checkpoint INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_file ON versions(file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_vault ON files(vault_id);
CREATE INDEX IF NOT EXISTS idx_vaults_user ON vaults(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
`;
export class DbService {
    db;
    constructor() {
        // Ensure directory exists
        const dbDir = dirname(config.databasePath);
        if (!existsSync(dbDir)) {
            mkdirSync(dbDir, { recursive: true });
        }
        this.db = new Database(config.databasePath);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(SCHEMA);
    }
    close() {
        this.db.close();
    }
    // ============================================================================
    // Device Operations
    // ============================================================================
    getDeviceById(id) {
        const row = this.db
            .prepare("SELECT * FROM devices WHERE id = ?")
            .get(id);
        return row ?? null;
    }
    getDevicesByUserId(userId) {
        return this.db
            .prepare("SELECT * FROM devices WHERE user_id = ?")
            .all(userId);
    }
    insertDevice(device) {
        this.db
            .prepare("INSERT INTO devices (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
            .run(device.id, device.user_id, device.name, device.created_at);
    }
    // ============================================================================
    // Vault Operations
    // ============================================================================
    getVaultById(id) {
        const row = this.db
            .prepare("SELECT * FROM vaults WHERE id = ?")
            .get(id);
        return row ?? null;
    }
    getVaultsByUserId(userId) {
        return this.db
            .prepare("SELECT * FROM vaults WHERE user_id = ? ORDER BY created_at DESC")
            .all(userId);
    }
    insertVault(vault) {
        this.db
            .prepare("INSERT INTO vaults (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .run(vault.id, vault.user_id, vault.name, vault.created_at, vault.updated_at);
    }
    // ============================================================================
    // File Operations
    // ============================================================================
    getFileById(id) {
        const row = this.db
            .prepare("SELECT * FROM files WHERE id = ?")
            .get(id);
        return row ?? null;
    }
    getFileByVaultAndPath(vaultId, path) {
        const row = this.db
            .prepare("SELECT * FROM files WHERE vault_id = ? AND path = ?")
            .get(vaultId, path);
        return row ?? null;
    }
    getFilesByVaultId(vaultId) {
        return this.db
            .prepare("SELECT * FROM files WHERE vault_id = ?")
            .all(vaultId);
    }
    insertFile(file) {
        this.db
            .prepare("INSERT INTO files (id, vault_id, path, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(file.id, file.vault_id, file.path, file.deleted_at, file.created_at, file.updated_at);
    }
    updateFile(id, updates) {
        const setClauses = [];
        const values = [];
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
        if (setClauses.length === 0)
            return;
        values.push(id);
        this.db
            .prepare(`UPDATE files SET ${setClauses.join(", ")} WHERE id = ?`)
            .run(...values);
    }
    // ============================================================================
    // Version Operations
    // ============================================================================
    getVersionById(id) {
        const row = this.db
            .prepare("SELECT * FROM versions WHERE id = ?")
            .get(id);
        if (!row)
            return null;
        return {
            ...row,
            is_checkpoint: Boolean(row.is_checkpoint),
        };
    }
    getVersionsByFileId(fileId) {
        const rows = this.db
            .prepare("SELECT * FROM versions WHERE file_id = ? ORDER BY created_at DESC")
            .all(fileId);
        return rows.map((row) => ({
            ...row,
            is_checkpoint: Boolean(row.is_checkpoint),
        }));
    }
    insertVersion(version) {
        this.db
            .prepare("INSERT INTO versions (id, file_id, device_id, is_checkpoint, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(version.id, version.file_id, version.device_id, version.is_checkpoint ? 1 : 0, version.data, version.created_at);
    }
    versionExists(id) {
        const row = this.db
            .prepare("SELECT 1 FROM versions WHERE id = ?")
            .get(id);
        return row !== undefined;
    }
}
// Singleton instance
let dbInstance = null;
export function getDb() {
    if (!dbInstance) {
        dbInstance = new DbService();
    }
    return dbInstance;
}
export function closeDb() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
