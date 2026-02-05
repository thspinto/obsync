import type { SyncVersionInput, SyncVersionsResponse } from "../../../shared/types.js";
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
export declare function syncVersions(ctx: SyncContext, versions: SyncVersionInput[]): SyncVersionsResponse;
