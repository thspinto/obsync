/**
 * Exports the @coder/logger instance for direct use in the plugin.
 */

import { Logger, BrowserFormatter, Level } from "@coder/logger";

const formatter = new BrowserFormatter();
export const logger = new Logger(formatter, "Obsync");

// Start at info level by default
logger.level = Level.Info;
