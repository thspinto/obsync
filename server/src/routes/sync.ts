import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authMiddleware, type AuthContext } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { syncVersions } from "../services/sync.js";
import { uuidv7 } from "../../../shared/types.js";
import type {
  CreateVaultRequest,
  VaultResponse,
  ListVaultsResponse,
  SyncVersionsRequest,
  SyncVersionsResponse,
} from "../../../shared/types.js";

const sync = new Hono<{
  Variables: {
    auth: AuthContext;
  };
}>();

// Apply auth middleware to all routes
sync.use("/*", authMiddleware);

// ============================================================================
// Vault Endpoints
// ============================================================================

/**
 * GET /vaults
 * List all vaults for the authenticated user
 */
sync.get("/vaults", (c) => {
  const { userId } = c.get("auth");
  const db = getDb();

  const vaults = db.getVaultsByUserId(userId);

  const result: ListVaultsResponse = {
    vaults: vaults.map((v) => ({
      id: v.id,
      name: v.name,
      created_at: v.created_at,
    })),
  };

  return c.json(result);
});

/**
 * POST /vaults
 * Create a new vault for the authenticated user
 */
sync.post("/vaults", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json<CreateVaultRequest>();

  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    throw new HTTPException(400, { message: "Vault name is required" });
  }

  const db = getDb();
  const now = Date.now();
  const id = uuidv7();

  db.insertVault({
    id,
    user_id: userId,
    name: body.name.trim(),
    created_at: now,
    updated_at: now,
  });

  const result: VaultResponse = {
    id,
    name: body.name.trim(),
    created_at: now,
  };

  return c.json(result, 201);
});

// ============================================================================
// Sync Endpoints
// ============================================================================

/**
 * POST /sync/versions
 * Upload versions to the server
 */
sync.post("/sync/versions", async (c) => {
  const { userId, deviceId } = c.get("auth");
  const body = await c.req.json<SyncVersionsRequest>();

  if (!body.vault_id) {
    throw new HTTPException(400, { message: "vault_id is required" });
  }

  if (!Array.isArray(body.versions)) {
    throw new HTTPException(400, { message: "versions must be an array" });
  }

  // Validate each version
  for (const v of body.versions) {
    if (!v.id || !v.file_path || !v.file_id || typeof v.is_checkpoint !== "boolean" || !v.data || !v.created_at) {
      throw new HTTPException(400, {
        message: `Invalid version: ${JSON.stringify(v)}`,
      });
    }
  }

  const result = syncVersions(
    { userId, deviceId, vaultId: body.vault_id },
    body.versions
  );

  return c.json(result);
});

export { sync };
