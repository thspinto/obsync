/**
 * Exports the @coder/logger instance for direct use in the plugin.
 */

import { Logger, BrowserFormatter, Level } from "@coder/logger";

const formatter = new BrowserFormatter();
export const logger = new Logger(formatter, "Obsync");

// Only log errors by default (debug mode enables full logging)
logger.level = Level.Error;
