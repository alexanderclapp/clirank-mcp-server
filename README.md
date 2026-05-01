# clirank-mcp-server

MCP server that exposes the CLIRank API directory as tools for AI agents. Search, compare, and get docs for 416+ APIs ranked by agent-friendliness.

Works with **Claude Code, Codex CLI, Cursor, Cline, Continue, Windsurf** - any MCP-compatible client. Connects to the live CLIRank API at `https://clirank.dev/api` - no database, no auth, no API key.

## Install

### Claude Code

```bash
claude mcp add clirank -- npx -y clirank-mcp-server@latest
```

Or add to `~/.claude.json` manually:

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

### Codex CLI

One-liner:

```bash
codex mcp add clirank -- npx -y clirank-mcp-server@latest
```

Or add to `~/.codex/config.toml` manually:

```toml
[mcp_servers.clirank]
command = "npx"
args = ["-y", "clirank-mcp-server@latest"]
```

### Cursor

Add to `~/.cursor/mcp.json` (or via Settings → MCP):

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

### Cline / Continue / Windsurf

Same pattern - point your client's MCP config at `npx -y clirank-mcp-server@latest`.

### Global install (any client)

```bash
npm install -g clirank-mcp-server
```

## Tools

### discover_apis

Search for APIs by intent. Describe what you need and get ranked matches.

- `query` (required) - what you need, e.g. "send transactional emails"
- `min_cli_score` (optional) - minimum CLI relevance score 1-10
- `pricing` (optional) - free, freemium, paid, pay-per-use, transaction-based
- `limit` (optional) - max results, default 10

### get_api_details

Get full details for a specific API including scores, pricing, CLI breakdown, and quality metrics.

- `slug` (required) - API slug, e.g. "stripe-api"

### get_api_docs

Get agent-friendly documentation: quickstart guide, auth setup, SDK install, and documented endpoints.

- `slug` (required) - API slug, e.g. "stripe-api"

### compare_apis

Compare 2-5 APIs side by side with a comparison table and recommendation.

- `slugs` (required) - array of API slugs, e.g. ["stripe-api", "paypal-api"]

### browse_categories

List all API categories with counts. No parameters.

### get_reviews

Get integration reports and reviews for an API. Includes structured data from agents and humans.

- `slug` (required) - API slug
- `limit` (optional) - max reviews, default 10

## Configuration

Set `CLIRANK_API_URL` to override the base API URL (defaults to `https://clirank.dev/api`).

## Development

```bash
npm install
npm run build
npm start
```
