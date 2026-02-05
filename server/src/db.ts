import Database from "better-sqlite3";
import { config } from "./config.js";
import type {
  DeviceRecord,
  VaultRecord,
  ServerFileRecord,
  ServerVersionRecord,
} from "../../shared/types.js";
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
  private db: Database.Database;

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

  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Device Operations
  // ============================================================================

  getDeviceById(id: string): DeviceRecord | null {
    const row = this.db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as DeviceRecord | undefined;
    return row ?? null;
  }

  getDevicesByUserId(userId: string): DeviceRecord[] {
    return this.db
      .prepare("SELECT * FROM devices WHERE user_id = ?")
      .all(userId) as DeviceRecord[];
  }

  insertDevice(device: DeviceRecord): void {
    this.db
      .prepare(
        "INSERT INTO devices (id, user_id, name, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(device.id, device.user_id, device.name, device.created_at);
  }

  // ============================================================================
  // Vault Operations
  // ============================================================================

  getVaultById(id: string): VaultRecord | null {
    const row = this.db
      .prepare("SELECT * FROM vaults WHERE id = ?")
      .get(id) as VaultRecord | undefined;
    return row ?? null;
  }

  getVaultsByUserId(userId: string): VaultRecord[] {
    return this.db
      .prepare("SELECT * FROM vaults WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as VaultRecord[];
  }

  insertVault(vault: VaultRecord): void {
    this.db
      .prepare(
        "INSERT INTO vaults (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(vault.id, vault.user_id, vault.name, vault.created_at, vault.updated_at);
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  getFileById(id: string): ServerFileRecord | null {
    const row = this.db
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(id) as (ServerFileRecord & { vault_id: string }) | undefined;
    return row ?? null;
  }

  getFileByVaultAndPath(vaultId: string, path: string): ServerFileRecord | null {
    const row = this.db
      .prepare("SELECT * FROM files WHERE vault_id = ? AND path = ?")
      .get(vaultId, path) as ServerFileRecord | undefined;
    return row ?? null;
  }

  getFilesByVaultId(vaultId: string): ServerFileRecord[] {
    return this.db
      .prepare("SELECT * FROM files WHERE vault_id = ?")
      .all(vaultId) as ServerFileRecord[];
  }

  insertFile(file: ServerFileRecord): void {
    this.db
      .prepare(
        "INSERT INTO files (id, vault_id, path, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        file.id,
        file.vault_id,
        file.path,
        file.deleted_at,
        file.created_at,
        file.updated_at
      );
  }

  updateFile(
    id: string,
    updates: Partial<Pick<ServerFileRecord, "path" | "deleted_at" | "updated_at">>
  ): void {
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
    this.db
      .prepare(`UPDATE files SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  // ============================================================================
  // Version Operations
  // ============================================================================

  getVersionById(id: string): ServerVersionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM versions WHERE id = ?")
      .get(id) as (Omit<ServerVersionRecord, "is_checkpoint"> & { is_checkpoint: number }) | undefined;
    if (!row) return null;
    return {
      ...row,
      is_checkpoint: Boolean(row.is_checkpoint),
    };
  }

  getVersionsByFileId(fileId: string): ServerVersionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM versions WHERE file_id = ? ORDER BY created_at DESC")
      .all(fileId) as (Omit<ServerVersionRecord, "is_checkpoint"> & { is_checkpoint: number })[];
    return rows.map((row) => ({
      ...row,
      is_checkpoint: Boolean(row.is_checkpoint),
    }));
  }

  insertVersion(version: ServerVersionRecord): void {
    this.db
      .prepare(
        "INSERT INTO versions (id, file_id, device_id, is_checkpoint, data, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        version.id,
        version.file_id,
        version.device_id,
        version.is_checkpoint ? 1 : 0,
        version.data,
        version.created_at
      );
  }

  versionExists(id: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM versions WHERE id = ?")
      .get(id);
    return row !== undefined;
  }
}

// Singleton instance
let dbInstance: DbService | null = null;

export function getDb(): DbService {
  if (!dbInstance) {
    dbInstance = new DbService();
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
