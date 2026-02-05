import { Hono } from "hono";
import { type AuthContext } from "../middleware/auth.js";
declare const sync: Hono<{
    Variables: {
        auth: AuthContext;
    };
}, import("hono/types").BlankSchema, "/">;
export { sync };
