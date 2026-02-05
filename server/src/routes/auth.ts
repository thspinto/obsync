import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { uuidv7 } from "../../../shared/types.js";
import type {
  DeviceAuthResponse,
  TokenRequest,
  TokenResponse,
  TokenPendingResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from "../../../shared/types.js";

const auth = new Hono();

/**
 * POST /auth/device
 * Initiate device authorization flow
 */
auth.post("/device", async (c) => {
  const response = await fetch(
    `https://${config.auth0.domain}/oauth/device/code`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.auth0.clientId,
        scope: "openid profile offline_access",
        audience: config.auth0.audience,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Auth0 device code error:", error);
    throw new HTTPException(500, { message: "Failed to initiate device authorization" });
  }

  const data = await response.json();

  const result: DeviceAuthResponse = {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri_complete || data.verification_uri,
    expires_in: data.expires_in,
    interval: data.interval,
  };

  return c.json(result);
});

/**
 * POST /auth/token
 * Poll for token after user authorizes device
 */
auth.post("/token", async (c) => {
  const body = await c.req.json<TokenRequest>();

  if (!body.device_code) {
    throw new HTTPException(400, { message: "device_code is required" });
  }

  const response = await fetch(`https://${config.auth0.domain}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: body.device_code,
      client_id: config.auth0.clientId,
    }),
  });

  const data = await response.json();

  // Handle pending authorization
  if (data.error === "authorization_pending") {
    const result: TokenPendingResponse = { status: "authorization_pending" };
    return c.json(result);
  }

  // Handle other errors
  if (data.error) {
    if (data.error === "slow_down") {
      throw new HTTPException(429, { message: "Polling too fast, slow down" });
    }
    if (data.error === "expired_token") {
      throw new HTTPException(400, { message: "Device code expired" });
    }
    if (data.error === "access_denied") {
      throw new HTTPException(403, { message: "User denied authorization" });
    }
    console.error("Auth0 token error:", data);
    throw new HTTPException(500, { message: `Token error: ${data.error_description || data.error}` });
  }

  // Decode the ID token to get user info
  const idTokenParts = data.id_token?.split(".");
  if (!idTokenParts || idTokenParts.length !== 3) {
    throw new HTTPException(500, { message: "Invalid id_token received" });
  }

  const payload = JSON.parse(
    Buffer.from(idTokenParts[1], "base64url").toString()
  );
  const userId = payload.sub;

  if (!userId) {
    throw new HTTPException(500, { message: "Could not extract user ID from token" });
  }

  // Create or get device for this user
  const db = getDb();
  const existingDevices = db.getDevicesByUserId(userId);

  let deviceId: string;

  // For simplicity, create a new device for each successful auth
  // In production, you might want to track device names/fingerprints
  deviceId = uuidv7();
  db.insertDevice({
    id: deviceId,
    user_id: userId,
    name: null,
    created_at: Date.now(),
  });

  // Note: In a production system, you would also want to:
  // 1. Store the refresh token server-side for the device
  // 2. Issue your own token that includes device_id in the claims
  // For simplicity, we're returning Auth0's tokens directly

  const result: TokenResponse = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    device_id: deviceId,
  };

  return c.json(result);
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
auth.post("/refresh", async (c) => {
  const body = await c.req.json<RefreshTokenRequest>();

  if (!body.refresh_token) {
    throw new HTTPException(400, { message: "refresh_token is required" });
  }

  const response = await fetch(`https://${config.auth0.domain}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
      client_id: config.auth0.clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error("Auth0 refresh error:", error);
    if (error.error === "invalid_grant") {
      throw new HTTPException(401, { message: "Refresh token expired or invalid" });
    }
    throw new HTTPException(500, { message: "Failed to refresh token" });
  }

  const data = await response.json();

  const result: RefreshTokenResponse = {
    access_token: data.access_token,
  };

  return c.json(result);
});

export { auth };
