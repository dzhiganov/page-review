#!/usr/bin/env node
// Standalone receiver, for saving reviews while no Claude Code session (MCP server) is running.
import { DEFAULT_PORT, startReceiver } from './http.js';
import { DATA_DIR } from './store.js';

const { status } = await startReceiver(DEFAULT_PORT);
if (status === 'shared') {
  console.log(`A page-review receiver is already running on port ${DEFAULT_PORT}.`);
  process.exit(0);
}
console.log(`Page Review receiver on http://localhost:${DEFAULT_PORT}, storing reviews in ${DATA_DIR}`);
