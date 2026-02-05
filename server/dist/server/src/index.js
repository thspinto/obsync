import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { auth } from "./routes/auth.js";
import { sync } from "./routes/sync.js";
import { closeDb } from "./db.js";
const app = new Hono();
// Middleware
app.use("*", logger());
app.use("*", cors({
    origin: "*", // In production, restrict to specific origins
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
}));
// Health check
app.get("/health", (c) => c.json({ status: "ok" }));
// Mount routes
app.route("/auth", auth);
app.route("/", sync);
// Error handling
app.onError((err, c) => {
    console.error("Server error:", err);
    return c.json({
        error: err.message || "Internal server error",
    }, 500);
});
// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("Received SIGTERM, shutting down...");
    closeDb();
    process.exit(0);
});
process.on("SIGINT", () => {
    console.log("Received SIGINT, shutting down...");
    closeDb();
    process.exit(0);
});
// Start server
console.log(`Starting Obsync server on port ${config.port}...`);
serve({
    fetch: app.fetch,
    port: config.port,
});
console.log(`Server running at http://localhost:${config.port}`);
