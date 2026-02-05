import type { DeviceRecord, VaultRecord, ServerFileRecord, ServerVersionRecord } from "../../shared/types.js";
export declare class DbService {
    private db;
    constructor();
    close(): void;
    getDeviceById(id: string): DeviceRecord | null;
    getDevicesByUserId(userId: string): DeviceRecord[];
    insertDevice(device: DeviceRecord): void;
    getVaultById(id: string): VaultRecord | null;
    getVaultsByUserId(userId: string): VaultRecord[];
    insertVault(vault: VaultRecord): void;
    getFileById(id: string): ServerFileRecord | null;
    getFileByVaultAndPath(vaultId: string, path: string): ServerFileRecord | null;
    getFilesByVaultId(vaultId: string): ServerFileRecord[];
    insertFile(file: ServerFileRecord): void;
    updateFile(id: string, updates: Partial<Pick<ServerFileRecord, "path" | "deleted_at" | "updated_at">>): void;
    getVersionById(id: string): ServerVersionRecord | null;
    getVersionsByFileId(fileId: string): ServerVersionRecord[];
    insertVersion(version: ServerVersionRecord): void;
    versionExists(id: string): boolean;
}
export declare function getDb(): DbService;
export declare function closeDb(): void;
