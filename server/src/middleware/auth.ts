import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import jwt, { JwtPayload } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config.js";

export interface AuthContext {
  userId: string;
  deviceId: string;
}

// Create JWKS client (Auth0's official library)
const client = jwksClient({
  jwksUri: `https://${config.auth0.domain}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

function verifyToken(token: string): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        issuer: `https://${config.auth0.domain}/`,
        audience: config.auth0.audience,
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded as JwtPayload);
        }
      }
    );
  });
}

/**
 * Auth middleware that verifies JWT tokens from Auth0
 * Extracts user_id (sub) and device_id from the token
 */
export const authMiddleware = createMiddleware<{
  Variables: {
    auth: AuthContext;
  };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing or invalid authorization header" });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token);

    const userId = payload.sub;
    const deviceId = payload.device_id as string | undefined;

    if (!userId) {
      throw new HTTPException(401, { message: "Invalid token: missing sub" });
    }

    if (!deviceId) {
      throw new HTTPException(401, { message: "Invalid token: missing device_id" });
    }

    c.set("auth", { userId, deviceId });
    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new HTTPException(401, { message: `Token verification failed: ${error.message}` });
    }
    throw new HTTPException(401, { message: "Token verification failed" });
  }
});
