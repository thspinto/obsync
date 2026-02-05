/**
 * Server configuration from environment variables
 */
export declare const config: {
    readonly port: number;
    readonly databasePath: string;
    readonly auth0: {
        readonly domain: string;
        readonly clientId: string;
        readonly clientSecret: string;
        readonly audience: string;
    };
};
export type Config = typeof config;
