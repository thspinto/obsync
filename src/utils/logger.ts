/**
 * Exports the @coder/logger instance for direct use in the plugin.
 */

import { Logger, BrowserFormatter, Level } from "@coder/logger";

const formatter = new BrowserFormatter();
export const logger = new Logger(formatter, "Obsync");

// Disable logging by default (only enabled when debug mode is on)
logger.level = Level.None;
