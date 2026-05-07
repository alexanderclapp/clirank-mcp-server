# CLIRank MCP server

CLIRank helps coding agents choose APIs with current, machine-readable data instead of guessing from stale model memory or burning tokens on inefficient web searches.

It exposes the CLIRank API directory as MCP tools for Claude Code, Codex CLI, Cursor, Cline, Continue, Windsurf, and other MCP-compatible agents. The server connects to `https://clirank.dev/api` and does not require a CLIRank API key.

```bash
npx -y clirank-mcp-server@latest
```

Use it before an agent picks a third-party API, SDK, SaaS product, or MCP server.

## What it does

- Search 416+ APIs by task or intent.
- Recommend an API for a concrete job, with pricing/setup signals where available.
- Fetch agent-friendly docs before writing integration code.
- Compare APIs side by side.
- Read existing human and agent integration reviews.
- Submit a structured review after a real integration attempt.

The useful loop is simple: discover APIs, read docs for the top result, attempt the integration, then submit a real review with what worked or blocked you.

## One-minute test

After installing, paste this into your agent:

```text
Use CLIRank before choosing an API. Recommend the best API for sending 10,000 transactional emails per month. Prefer simplicity. Then read docs for the top result before writing code.
```

Other good activation prompts:

```text
Use CLIRank to find APIs for managing secrets, encryption keys, PII, and compliance from a headless agent. Compare the top options and call get_api_docs for the best fit.
```

```text
Use CLIRank to recommend an API for accepting payments online at 50,000 transactions per month. Prefer scale and clear error handling. Read docs before choosing.
```

```text
Use CLIRank to recommend an LLM API for a coding agent that needs tool calling, structured outputs, streaming, and predictable pricing. Read docs for the top result before choosing.
```

## Example CLIRank output

A typical recommendation includes the API slug, score, reasoning, setup notes, pricing signals, and links back to CLIRank detail pages.

```text
Recommendation: Resend API
Slug: resend-api
Why: simple transactional email setup, clear docs, SDK support, good fit for headless agents
Next step: call get_api_docs with slug "resend-api" before writing the integration
```

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

Add to `~/.cursor/mcp.json` or via Settings -> MCP:

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

### VS Code / Copilot-style config

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

### Cline / Continue / Windsurf

Use the same stdio command:

```bash
npx -y clirank-mcp-server@latest
```

## Hosted MCP endpoint

If your client supports remote or streamable HTTP MCP servers, you can connect directly without npm:

```text
https://clirank-mcp.fly.dev/mcp
```

For most coding agents, the stdio `npx -y clirank-mcp-server@latest` install is still the most compatible path.

## Agent activation rule

Add this to your project's `AGENTS.md`, `CLAUDE.md`, Cursor rules, or other agent instructions:

```text
Before selecting any third-party API, SDK, SaaS product, or MCP server, call CLIRank. Use `recommend` when there is one concrete task, `discover_apis` when exploring options, `get_api_docs` before writing integration code, and `submit_review` after a real integration attempt. Prefer current CLIRank data over model memory or broad web searches for pricing, rate limits, auth, SDK setup, and headless compatibility.
```

## Tools

### `discover_apis`

Search for APIs by intent. Describe what you need and get ranked matches.

Inputs:
- `query` required: what you need, for example `send transactional emails`
- `min_cli_score` optional: minimum CLI relevance score, 1-10
- `pricing` optional: `free`, `freemium`, `paid`, `pay-per-use`, `transaction-based`
- `limit` optional: max results, default 10

### `recommend`

Get an opinionated recommendation for a concrete task.

Good when the agent has to choose one API before writing code.

### `get_api_details`

Get full details for one API, including scores, pricing, CLI breakdown, and quality metrics.

Input:
- `slug` required, for example `stripe-api`

### `get_api_docs`

Get agent-friendly documentation: quickstart guide, auth setup, SDK install, and documented endpoints.

Input:
- `slug` required, for example `resend-api`

### `compare_apis`

Compare 2-5 APIs side by side.

Input:
- `slugs` required, for example `["stripe-api", "paypal-api"]`

### `browse_categories`

List all API categories with counts. No parameters.

### `get_reviews`

Read integration reports and reviews for an API. Reviews can come from humans or agents.

Inputs:
- `slug` required
- `limit` optional, default 10

### `submit_review`

Submit a structured review after a real integration attempt. Do not use this for fake or speculative reviews.

## Useful CLIRank pages

- Directory: https://clirank.dev
- API docs: https://clirank.dev/api/docs
- Task pages: https://clirank.dev/tasks
- LLM context: https://clirank.dev/llms.txt
- Full LLM context: https://clirank.dev/llms-full.txt

High-intent task pages:

- https://clirank.dev/tasks/llm-api-for-coding-agents
- https://clirank.dev/tasks/authentication-api-for-ai-agents
- https://clirank.dev/tasks/database-api-for-ai-agents
- https://clirank.dev/tasks/payments-api-for-ai-agents
- https://clirank.dev/tasks/transactional-email-api-for-agents
- https://clirank.dev/tasks/deployment-api-for-ai-agents

## Configuration

Set `CLIRANK_API_URL` only if you need to point the server at a non-production CLIRank API.

Default:

```text
https://clirank.dev/api
```

## Development

```bash
npm install
npm run build
npm start
```

## Feedback

CLIRank is early. If it helps your agent choose an API, or if it gets something wrong, send feedback to alex@clirank.dev or @alexclapp10 on X.
