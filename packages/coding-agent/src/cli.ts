#!/usr/bin/env node
import { resolve } from "node:path";
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { config as dotenvConfig } from "dotenv";

// Load .env from project root
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { main } from "./main.ts";

process.title = APP_NAME;
process.env.PI_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

// Configure undici's global dispatcher before provider SDKs issue requests.
// Runtime settings are applied once SettingsManager has loaded global/project settings.
configureHttpDispatcher();

main(process.argv.slice(2));
