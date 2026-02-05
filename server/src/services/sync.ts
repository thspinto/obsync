import { getDb } from "../db.js";
import { uuidv7 } from "../../../shared/types.js";
import type {
  SyncVersionInput,
  SyncVersionsResponse,
  ServerFileRecord,
  ServerVersionRecord,
} from "../../../shared/types.js";

export interface SyncContext {
  userId: string;
  deviceId: string;
  vaultId: string;
}

/**
 * Process version uploads from a client
 * Creates files if they don't exist, inserts versions
 * Returns list of successfully synced version IDs
 */
export function syncVersions(
  ctx: SyncContext,
  versions: SyncVersionInput[]
): SyncVersionsResponse {
  const db = getDb();
  const synced: string[] = [];
  const errors: Array<{ version_id: string; error: string }> = [];

  // Verify vault exists and belongs to user
  const vault = db.getVaultById(ctx.vaultId);
  if (!vault) {
    return {
      synced: [],
      errors: versions.map((v) => ({
        version_id: v.id,
        error: "Vault not found",
      })),
    };
  }

  if (vault.user_id !== ctx.userId) {
    return {
      synced: [],
      errors: versions.map((v) => ({
        version_id: v.id,
        error: "Access denied to vault",
      })),
    };
  }

  for (const version of versions) {
    try {
      // Skip if version already exists (idempotent)
      if (db.versionExists(version.id)) {
        synced.push(version.id);
        continue;
      }

      // Get or create file by path
      let file = db.getFileByVaultAndPath(ctx.vaultId, version.file_path);

      if (!file) {
        // Create file record
        // Use the client's file_id if the file doesn't exist
        const now = Date.now();
        const newFile: ServerFileRecord = {
          id: version.file_id,
          vault_id: ctx.vaultId,
          path: version.file_path,
          deleted_at: null,
          created_at: version.created_at,
          updated_at: now,
        };

        // Check if file ID already exists (from another path)
        const existingById = db.getFileById(version.file_id);
        if (existingById) {
          // File exists with different path - use the existing file
          file = existingById;
        } else {
          db.insertFile(newFile);
          file = newFile;
        }
      } else {
        // Update file's updated_at
        db.updateFile(file.id, { updated_at: Date.now() });
      }

      // Insert version
      const serverVersion: ServerVersionRecord = {
        id: version.id,
        file_id: file.id,
        device_id: ctx.deviceId,
        is_checkpoint: version.is_checkpoint,
        data: version.data,
        created_at: version.created_at,
      };

      db.insertVersion(serverVersion);
      synced.push(version.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push({ version_id: version.id, error: message });
    }
  }

  return { synced, errors };
}
