import { Notice, requestUrl } from "obsidian";
import { DbService, VersionRecord } from "./db";
import { ObsyncSettings } from "./settings";
import { logger } from "./utils/logger";
import { field } from "@coder/logger";

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  device_id: string;
}

interface TokenPendingResponse {
  status: "authorization_pending";
}

interface SyncVersionInput {
  id: string;
  file_path: string;
  file_id: string;
  is_checkpoint: boolean;
  data: string;
  created_at: number;
}

interface SyncVersionsResponse {
  synced: string[];
  errors: Array<{ version_id: string; error: string }>;
}

interface VaultResponse {
  id: string;
  name: string;
  created_at: number;
}

interface ListVaultsResponse {
  vaults: VaultResponse[];
}

export class SyncService {
  private db: DbService;
  private settings: ObsyncSettings;
  private saveSettings: () => Promise<void>;
  private pollingInterval: number | null = null;
  private vaultName: string | null = null;

  constructor(
    db: DbService,
    settings: ObsyncSettings,
    saveSettings: () => Promise<void>
  ) {
    this.db = db;
    this.settings = settings;
    this.saveSettings = saveSettings;
  }

  /**
   * Check if sync is enabled and configured
   */
  isEnabled(): boolean {
    return Boolean(
      this.settings.serverUrl &&
      this.settings.accessToken &&
      this.settings.vaultId
    );
  }

  /**
   * Initiate device authorization flow
   * Returns the verification URI and user code for the user to complete auth
   */
  async initiateLogin(): Promise<{ userCode: string; verificationUri: string }> {
    if (!this.settings.serverUrl) {
      throw new Error("Server URL not configured");
    }

    logger.debug("Initiating device auth flow", field("context", "Sync"));

    const response = await requestUrl({
      url: `${this.settings.serverUrl}/auth/device`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to initiate login: ${response.text}`);
    }

    const data = response.json as DeviceAuthResponse;

    // Start polling for token
    this.startTokenPolling(data.device_code, data.interval);

    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
    };
  }

  /**
   * Poll for token completion after user authorizes
   */
  private startTokenPolling(deviceCode: string, intervalSeconds: number): void {
    // Clear any existing polling
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
    }

    const pollForToken = async () => {
      try {
        const response = await requestUrl({
          url: `${this.settings.serverUrl}/auth/token`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: deviceCode }),
        });

        const data = response.json;

        if ("status" in data && data.status === "authorization_pending") {
          // Still waiting for user to authorize
          logger.debug("Authorization pending...", field("context", "Sync"));
          return;
        }

        // Success - we have tokens
        const tokenData = data as TokenResponse;
        this.settings.accessToken = tokenData.access_token;
        this.settings.refreshToken = tokenData.refresh_token;
        this.settings.deviceId = tokenData.device_id;
        await this.saveSettings();

        // Stop polling
        if (this.pollingInterval !== null) {
          window.clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }

        new Notice("Obsync: Login successful!");
        logger.info("Login successful", field("context", "Sync"), field("deviceId", tokenData.device_id));
      } catch (error) {
        logger.error("Token polling error", field("context", "Sync"), field("error", error));
        // Stop polling on error
        if (this.pollingInterval !== null) {
          window.clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
        new Notice(`Obsync: Login failed - ${error}`);
      }
    };

    // Poll every interval seconds
    this.pollingInterval = window.setInterval(pollForToken, intervalSeconds * 1000);
    // Also poll immediately
    pollForToken();
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<boolean> {
    if (!this.settings.serverUrl || !this.settings.refreshToken) {
      return false;
    }

    try {
      logger.debug("Refreshing access token", field("context", "Sync"));

      const response = await requestUrl({
        url: `${this.settings.serverUrl}/auth/refresh`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: this.settings.refreshToken }),
      });

      if (response.status !== 200) {
        logger.error("Token refresh failed", field("context", "Sync"), field("status", response.status));
        return false;
      }

      const data = response.json as { access_token: string };
      this.settings.accessToken = data.access_token;
      await this.saveSettings();

      logger.debug("Access token refreshed", field("context", "Sync"));
      return true;
    } catch (error) {
      logger.error("Token refresh error", field("context", "Sync"), field("error", error));
      return false;
    }
  }

  /**
   * Ensure the vault exists on the server, creating it if necessary
   * Returns true if vault is ready, false if sync should be skipped
   */
  private async ensureVaultExists(): Promise<boolean> {
    if (!this.settings.serverUrl || !this.settings.accessToken) {
      return false;
    }

    // Get the local vault name to use for creating/finding vault on server
    const vaultName = this.getVaultName();
    if (!vaultName) {
      logger.error("Could not determine vault name", field("context", "Sync"));
      return false;
    }

    try {
      // First, check if we already have a valid vaultId that exists on server
      if (this.settings.vaultId) {
        // Verify the vault exists by listing vaults
        const response = await this.makeAuthenticatedRequest(
          `${this.settings.serverUrl}/sync/vaults`,
          "GET"
        ) as ListVaultsResponse;

        const existingVault = response.vaults.find(v => v.id === this.settings.vaultId);
        if (existingVault) {
          logger.debug("Vault exists on server", field("context", "Sync"), field("vaultId", this.settings.vaultId));
          return true;
        }

        // VaultId is set but doesn't exist on server - check if there's a vault with the same name
        const vaultByName = response.vaults.find(v => v.name === vaultName);
        if (vaultByName) {
          logger.info("Found existing vault by name, updating vaultId", field("context", "Sync"), field("vaultId", vaultByName.id));
          this.settings.vaultId = vaultByName.id;
          await this.saveSettings();
          return true;
        }
      } else {
        // No vaultId set - check if there's already a vault with this name
        const response = await this.makeAuthenticatedRequest(
          `${this.settings.serverUrl}/sync/vaults`,
          "GET"
        ) as ListVaultsResponse;

        const existingVault = response.vaults.find(v => v.name === vaultName);
        if (existingVault) {
          logger.info("Found existing vault by name", field("context", "Sync"), field("vaultId", existingVault.id));
          this.settings.vaultId = existingVault.id;
          await this.saveSettings();
          return true;
        }
      }

      // Vault doesn't exist - create it
      logger.info("Creating vault on server", field("context", "Sync"), field("vaultName", vaultName));
      const createResponse = await this.makeAuthenticatedRequest(
        `${this.settings.serverUrl}/sync/vaults`,
        "POST",
        { name: vaultName }
      ) as VaultResponse;

      this.settings.vaultId = createResponse.id;
      await this.saveSettings();
      logger.info("Vault created on server", field("context", "Sync"), field("vaultId", createResponse.id));
      return true;
    } catch (error) {
      logger.error("Failed to ensure vault exists", field("context", "Sync"), field("error", error));
      return false;
    }
  }

  /**
   * Get the vault name from the app
   * This is set by the plugin when it initializes
   */
  private getVaultName(): string | null {
    return this.vaultName;
  }

  /**
   * Set the vault name (called from plugin initialization)
   */
  setVaultName(name: string): void {
    this.vaultName = name;
  }

  /**
   * Sync unsynced versions to the server
   */
  async sync(): Promise<void> {
    if (!this.settings.serverUrl || !this.settings.accessToken) {
      logger.debug("Sync not configured, skipping", field("context", "Sync"));
      return;
    }

    // Ensure vault exists on server before syncing
    const vaultReady = await this.ensureVaultExists();
    if (!vaultReady) {
      logger.debug("Vault not ready, skipping sync", field("context", "Sync"));
      return;
    }

    const unsyncedVersions = this.db.getUnsyncedVersions();
    if (unsyncedVersions.length === 0) {
      logger.debug("No versions to sync", field("context", "Sync"));
      return;
    }

    logger.info(`Syncing ${unsyncedVersions.length} versions`, field("context", "Sync"));

    // Prepare versions for upload
    const versionsToSync: SyncVersionInput[] = unsyncedVersions.map((v) => ({
      id: v.id,
      file_path: v.file_path,
      file_id: v.file_id,
      is_checkpoint: v.is_checkpoint,
      data: v.data,
      created_at: v.created_at,
    }));

    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.settings.serverUrl}/sync/versions`,
        "POST",
        {
          vault_id: this.settings.vaultId,
          versions: versionsToSync,
        }
      );

      const result = response as SyncVersionsResponse;

      // Mark synced versions
      if (result.synced.length > 0) {
        this.db.markVersionsSynced(result.synced);
        await this.db.save();
        logger.info(`Synced ${result.synced.length} versions`, field("context", "Sync"));
      }

      // Log errors
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          logger.error(`Sync error for version ${err.version_id}: ${err.error}`, field("context", "Sync"));
        }
      }
    } catch (error) {
      logger.error("Sync failed", field("context", "Sync"), field("error", error));
    }
  }

  /**
   * Make an authenticated request, refreshing token if needed
   */
  private async makeAuthenticatedRequest(
    url: string,
    method: string,
    body?: unknown
  ): Promise<unknown> {
    const doRequest = async () => {
      const response = await requestUrl({
        url,
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.accessToken}`,
          "X-Device-ID": this.settings.deviceId,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 401) {
        throw new Error("Unauthorized");
      }

      if (response.status >= 400) {
        throw new Error(`Request failed: ${response.text}`);
      }

      return response.json;
    };

    try {
      return await doRequest();
    } catch (error) {
      // If unauthorized, try to refresh token and retry
      if (error instanceof Error && error.message === "Unauthorized") {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return await doRequest();
        }
        // Clear tokens if refresh failed
        this.settings.accessToken = "";
        this.settings.refreshToken = "";
        this.settings.deviceId = "";
        await this.saveSettings();
        throw new Error("Session expired, please login again");
      }
      throw error;
    }
  }

  /**
   * Run the sync daemon - called periodically
   */
  async runSyncDaemon(): Promise<void> {
    logger.debug("Running sync daemon", field("context", "Sync"));
    await this.sync();
  }

  /**
   * Stop any ongoing polling
   */
  stop(): void {
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
