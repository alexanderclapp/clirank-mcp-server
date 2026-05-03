# CLIRank MCP Server install guide for AI agents

CLIRank is an MCP server for choosing APIs at coding time. It exposes tools for API discovery, recommendations, comparisons, docs, package info, existing reviews, and structured review submission.

## What to install

Use the published npm package:

```bash
npx -y clirank-mcp-server@latest
```

No API key is required. The server talks to `https://clirank.dev/api` by default.

## Standard MCP config

Use this config for MCP clients that support `mcpServers`:

```json
{
  "mcpServers": {
    "clirank": {
      "command": "npx",
      "args": ["-y", "clirank-mcp-server@latest"]
    }
  }
}
```

## VS Code / Copilot-style config

For clients that use `servers` with an explicit transport type:

```json
{
  "servers": {
    "clirank": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "clirank-mcp-server@latest"]
    }
  }
}
```

## Optional environment override

Only set this if you need a non-production CLIRank API:

```json
{
  "CLIRANK_API_URL": "https://clirank.dev/api"
}
```

## Verify after install

After installing, call one of these tools:

- `discover_apis` with query `send transactional emails`
- `recommend` with use case `payments for a SaaS app`
- `browse_categories` with no arguments

Expected result: the tool returns ranked API data from CLIRank without requiring credentials.

## When to use CLIRank

Use CLIRank before choosing an API or SDK in a coding task. Prefer `recommend` when the user has a concrete use case, `discover_apis` when exploring options, and `submit_review` after completing a real integration so future agents get better recommendations.
