/**
 * Shared types for Obsync client and server
 */
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
    is_checkpoint: boolean;
    data: string;
    created_at: number;
}
export interface DeviceRecord {
    id: string;
    user_id: string;
    name: string | null;
    created_at: number;
}
export interface VaultRecord {
    id: string;
    user_id: string;
    name: string;
    created_at: number;
    updated_at: number;
}
export interface ServerFileRecord extends FileRecord {
    vault_id: string;
}
export interface ServerVersionRecord extends VersionRecord {
    device_id: string;
}
export interface DeviceAuthResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}
export interface TokenRequest {
    device_code: string;
}
export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    device_id: string;
}
export interface TokenPendingResponse {
    status: "authorization_pending";
}
export interface RefreshTokenRequest {
    refresh_token: string;
}
export interface RefreshTokenResponse {
    access_token: string;
}
export interface CreateVaultRequest {
    name: string;
}
export interface VaultResponse {
    id: string;
    name: string;
    created_at: number;
}
export interface ListVaultsResponse {
    vaults: VaultResponse[];
}
export interface SyncVersionInput {
    id: string;
    file_path: string;
    file_id: string;
    is_checkpoint: boolean;
    data: string;
    created_at: number;
}
export interface SyncVersionsRequest {
    vault_id: string;
    versions: SyncVersionInput[];
}
export interface SyncVersionsResponse {
    synced: string[];
    errors: Array<{
        version_id: string;
        error: string;
    }>;
}
/**
 * Generate a UUIDv7 string.
 * UUIDv7 embeds a Unix timestamp (milliseconds) in the first 48 bits,
 * making them time-sortable while remaining globally unique.
 */
export declare function uuidv7(): string;
