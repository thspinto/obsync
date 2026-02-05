/**
 * Server configuration from environment variables
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databasePath: process.env.DATABASE_PATH || "./data/obsync.db",

  auth0: {
    domain: requireEnv("AUTH0_DOMAIN"),
    clientId: requireEnv("AUTH0_CLIENT_ID"),
    clientSecret: requireEnv("AUTH0_CLIENT_SECRET"),
    audience: requireEnv("AUTH0_AUDIENCE"),
  },
} as const;

export type Config = typeof config;
