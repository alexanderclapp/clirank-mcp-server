#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /const MCP_SOURCE_HINT\s*=\s*"mcp-server"/,
  'MCP server must define a stable source hint for CLIRank runtime attribution',
);

assert.match(
  source,
  /url\.searchParams\.set\("source_hint", MCP_SOURCE_HINT\)/,
  'MCP GET calls must attach source_hint=mcp-server by default so runtime calls remain attributable if a client/proxy rewrites User-Agent',
);

assert.match(
  source,
  /params\.source_hint\s*===\s*undefined/,
  'MCP GET source hint should only be added when callers did not explicitly provide one',
);

console.log('source attribution contract checks passed');
