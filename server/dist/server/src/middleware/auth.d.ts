export interface AuthContext {
    userId: string;
    deviceId: string;
}
/**
 * Auth middleware that verifies JWT tokens from Auth0
 * Extracts user_id (sub) and device_id from the token
 */
export declare const authMiddleware: import("hono").MiddlewareHandler<{
    Variables: {
        auth: AuthContext;
    };
}, string, {}, Response>;
