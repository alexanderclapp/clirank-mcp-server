#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";
// ---------- Config ----------
const BASE_URL = process.env.CLIRANK_API_URL || "https://clirank.dev/api";
// ---------- HTTP helpers ----------
async function apiGet(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "")
            url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
        headers: { "User-Agent": "clirank-mcp/0.2.0" },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`CLIRank API ${res.status}: ${body || res.statusText}`);
    }
    return res.json();
}
function textResult(text) {
    return { content: [{ type: "text", text }] };
}
function errorResult(msg) {
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}
// ---------- MCP Server ----------
const server = new McpServer({
    name: "clirank",
    version: "0.2.0",
});
// Tool 1: discover_apis
server.tool("discover_apis", "Search for APIs by intent or capability. Describe what you need and get ranked matches. Examples: 'send transactional emails', 'process payments', 'image generation'.", {
    query: z.string().describe("What you need, e.g. 'send transactional emails'"),
    min_cli_score: z.number().min(1).max(10).optional().describe("Minimum CLI relevance score (1-10)"),
    pricing: z.enum(["free", "freemium", "paid", "pay-per-use", "transaction-based"]).optional().describe("Pricing filter"),
    limit: z.number().min(1).max(50).optional().describe("Max results (default 10, max 50)"),
}, async ({ query, min_cli_score, pricing, limit }) => {
    try {
        const params = { q: query };
        if (min_cli_score !== undefined)
            params.min_cli = String(min_cli_score);
        if (pricing)
            params.pricing = pricing;
        if (limit !== undefined)
            params.limit = String(limit);
        const data = await apiGet("/discover", params);
        if (data.count === 0) {
            return textResult(`No APIs found matching "${query}". Try broader terms or remove filters.`);
        }
        const lines = [`Found ${data.count} APIs matching "${query}":\n`];
        for (const r of data.results) {
            lines.push(`## ${r.name}`);
            lines.push(`Slug: ${r.slug} | Category: ${r.category}`);
            lines.push(`CLI Score: ${r.cliRelevanceScore ?? "N/A"} | Quality: ${r.qualityScore ?? "N/A"} | Pricing: ${r.pricing}`);
            lines.push(`${r.description}`);
            if (r.capabilities.length)
                lines.push(`Capabilities: ${r.capabilities.join(", ")}`);
            if (r.agentDocs.hasQuickstart)
                lines.push(`Agent docs: quickstart available, ${r.agentDocs.endpointCount} endpoints documented`);
            lines.push(`Details: ${r.detailUrl}`);
            lines.push("");
        }
        return textResult(lines.join("\n"));
    }
    catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
// Tool 2: get_api_details
server.tool("get_api_details", "Get full details for a specific API by its slug. Returns scores, pricing, auth method, capabilities, and quality breakdown.", {
    slug: z.string().describe("API slug, e.g. 'stripe-api', 'openai-api'"),
}, async ({ slug }) => {
    try {
        // Fetch the API via the apis endpoint with name search
        const data = await apiGet("/apis", { q: slug, limit: "5" });
        // Try exact slug match first, then closest match
        const api = data.apis.find(a => slugify(a.name) === slug) || data.apis[0];
        if (!api) {
            return errorResult(`No API found with slug "${slug}". Use discover_apis to search.`);
        }
        const lines = [
            `## ${api.name}`,
            "",
            api.description,
            "",
            `| Field | Value |`,
            `|-------|-------|`,
            `| Category | ${api.category} / ${api.subcategory} |`,
            `| Pricing | ${api.pricing} |`,
            `| CLI Relevance | ${api.cliRelevanceScore ?? "N/A"}/10 |`,
            `| Quality Score | ${api.qualityScore ?? "N/A"}/10 |`,
            `| Overall Score | ${api.overallScore ?? "N/A"} |`,
            `| npm Package | ${api.npmPackage || "N/A"} |`,
            `| Weekly Downloads | ${api.weeklyDownloads?.toLocaleString() ?? "N/A"} |`,
            `| URL | ${api.url} |`,
        ];
        if (api.capabilities.length) {
            lines.push("", `Capabilities: ${api.capabilities.join(", ")}`);
        }
        if (api.dataTypes.length) {
            lines.push(`Data Types: ${api.dataTypes.join(", ")}`);
        }
        if (api.cliBreakdown) {
            lines.push("", "### CLI Breakdown");
            for (const [k, v] of Object.entries(api.cliBreakdown)) {
                lines.push(`- ${formatKey(k)}: ${v ? "Yes" : "No"}`);
            }
        }
        if (api.qualityBreakdown) {
            lines.push("", "### Quality Breakdown");
            for (const [k, v] of Object.entries(api.qualityBreakdown)) {
                lines.push(`- ${formatKey(k)}: ${v}`);
            }
        }
        return textResult(lines.join("\n"));
    }
    catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
// Tool 3: get_api_docs
server.tool("get_api_docs", "Get agent-friendly documentation for an API, including quickstart guide and documented endpoints. Use this before integrating an API.", {
    slug: z.string().describe("API slug, e.g. 'stripe-api', 'openai-api'"),
}, async ({ slug }) => {
    try {
        const data = await apiGet("/docs", { slug });
        const lines = [
            `## ${data.api.name} - Agent Docs`,
            "",
            `Category: ${data.api.category} | Pricing: ${data.api.pricing}`,
            `CLI Score: ${data.api.cliRelevanceScore ?? "N/A"} | Quality: ${data.api.qualityScore ?? "N/A"}`,
            `URL: ${data.api.url}`,
            "",
        ];
        if (data.quickstart) {
            const qs = data.quickstart;
            lines.push("### Quickstart");
            if (qs.baseUrl)
                lines.push(`Base URL: ${qs.baseUrl}`);
            if (qs.officialDocsUrl)
                lines.push(`Official docs: ${qs.officialDocsUrl}`);
            if (qs.auth && typeof qs.auth === "object") {
                const auth = qs.auth;
                lines.push(`Auth: ${auth.method}${auth.header ? ` (${auth.header})` : ""}`);
                if (auth.envVar)
                    lines.push(`Env var: ${auth.envVar}`);
            }
            if (qs.sdk && typeof qs.sdk === "object") {
                const sdk = qs.sdk;
                if (sdk.install)
                    lines.push(`\nInstall: \`${sdk.install}\``);
                if (sdk.import)
                    lines.push(`Import: \`${sdk.import}\``);
                if (sdk.init)
                    lines.push(`Init: \`${sdk.init}\``);
            }
            if (Array.isArray(qs.requiredEnvVars) && qs.requiredEnvVars.length) {
                lines.push(`\nRequired env vars: ${qs.requiredEnvVars.join(", ")}`);
            }
            if (qs.rateLimits && typeof qs.rateLimits === "object") {
                const rl = qs.rateLimits;
                lines.push(`Rate limits: ${rl.requests ?? "?"} requests per ${rl.window ?? "?"}`);
            }
            if (Array.isArray(qs.gotchas) && qs.gotchas.length) {
                lines.push("\nGotchas:");
                for (const g of qs.gotchas)
                    lines.push(`- ${g}`);
            }
            lines.push(`\nConfidence: ${qs.confidence ?? "N/A"} | Contributions: ${qs.contributionCount ?? 0}`);
            lines.push("");
        }
        else {
            lines.push("No quickstart documentation available yet.\n");
        }
        if (data.endpoints.length) {
            lines.push(`### Documented Endpoints (${data.totalEndpoints})\n`);
            for (const ep of data.endpoints) {
                lines.push(`- \`${ep.method} ${ep.path}\` - ${ep.summary || "No summary"} (confidence: ${ep.confidence})`);
            }
        }
        else {
            lines.push("No endpoint documentation available yet.");
        }
        return textResult(lines.join("\n"));
    }
    catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
// Tool 4: compare_apis
server.tool("compare_apis", "Compare two or more APIs side by side. Returns a comparison table with scores, pricing, auth, and capabilities.", {
    slugs: z.array(z.string()).min(2).max(5).describe("Array of API slugs to compare, e.g. ['stripe-api', 'paypal-api']"),
}, async ({ slugs }) => {
    try {
        // Fetch all APIs in parallel
        const results = await Promise.all(slugs.map(async (slug) => {
            const data = await apiGet("/apis", { q: slug, limit: "5" });
            const api = data.apis.find(a => slugify(a.name) === slug) || data.apis[0];
            return { slug, api: api || null };
        }));
        const missing = results.filter(r => !r.api).map(r => r.slug);
        if (missing.length) {
            return errorResult(`APIs not found: ${missing.join(", ")}. Use discover_apis to find valid slugs.`);
        }
        const apis = results.map(r => r.api);
        const names = apis.map(a => a.name);
        // Build comparison table
        const header = `| | ${names.join(" | ")} |`;
        const separator = `|---|${names.map(() => "---").join("|")}|`;
        const rows = [
            `| Category | ${apis.map(a => a.category).join(" | ")} |`,
            `| Pricing | ${apis.map(a => a.pricing).join(" | ")} |`,
            `| CLI Score | ${apis.map(a => a.cliRelevanceScore ?? "N/A").join(" | ")} |`,
            `| Quality | ${apis.map(a => a.qualityScore ?? "N/A").join(" | ")} |`,
            `| Overall | ${apis.map(a => a.overallScore ?? "N/A").join(" | ")} |`,
            `| npm | ${apis.map(a => a.npmPackage || "N/A").join(" | ")} |`,
            `| Downloads/wk | ${apis.map(a => a.weeklyDownloads?.toLocaleString() ?? "N/A").join(" | ")} |`,
        ];
        // CLI breakdown comparison if available
        const hasBreakdown = apis.some(a => a.cliBreakdown);
        if (hasBreakdown) {
            const keys = ["hasOfficialSdk", "envVarAuth", "headlessCompatible", "hasCli", "jsonResponse"];
            for (const key of keys) {
                rows.push(`| ${formatKey(key)} | ${apis.map(a => a.cliBreakdown?.[key] ? "Yes" : "No").join(" | ")} |`);
            }
        }
        // Capabilities
        rows.push(`| Capabilities | ${apis.map(a => a.capabilities.length ? a.capabilities.slice(0, 5).join(", ") : "N/A").join(" | ")} |`);
        const lines = [
            `## API Comparison`,
            "",
            header,
            separator,
            ...rows,
            "",
        ];
        // Add descriptions
        for (const api of apis) {
            lines.push(`### ${api.name}`);
            lines.push(api.description);
            lines.push("");
        }
        // Recommendation
        const scored = apis
            .map(a => ({ name: a.name, score: (a.cliRelevanceScore ?? 0) + (a.qualityScore ?? 0) }))
            .sort((a, b) => b.score - a.score);
        if (scored[0].score > scored[1].score) {
            lines.push(`**Recommendation:** ${scored[0].name} scores highest (${scored[0].score} combined CLI + quality).`);
        }
        else {
            lines.push(`**Recommendation:** ${scored[0].name} and ${scored[1].name} score equally. Choose based on your specific requirements.`);
        }
        return textResult(lines.join("\n"));
    }
    catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
// Tool 5: browse_categories
server.tool("browse_categories", "List all API categories in the CLIRank directory with the number of APIs in each.", {}, async () => {
    try {
        const data = await apiGet("/apis", { limit: "1" });
        const lines = [
            "## API Categories\n",
            "| Category | APIs |",
            "|----------|------|",
        ];
        const sorted = data.categories.sort((a, b) => b.count - a.count);
        for (const cat of sorted) {
            lines.push(`| ${cat.name} | ${cat.count} |`);
        }
        lines.push("");
        lines.push(`Total: ${sorted.reduce((sum, c) => sum + c.count, 0)} APIs across ${sorted.length} categories`);
        lines.push("");
        lines.push("Use discover_apis to search within a category, or get_api_details with a slug for full info.");
        return textResult(lines.join("\n"));
    }
    catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
// Tool 6: get_reviews
server.tool("get_reviews", "Get integration reports and reviews for an API. Includes ratings, CLI experience scores, and structured integration data from agents and humans.", {
    slug: z.string().describe("API slug, e.g. 'openai-api'"),
    limit: z.number().min(1).max(100).optional().describe("Max reviews to return (default 10)"),
}, async ({ slug, limit }) => {
    try {
        const params = {
            target_type: "api",
            slug,
        };
        if (limit !== undefined)
            params.limit = String(limit);
        else
            params.limit = "10";
        const data = await apiGet("/reviews", params);
        const lines = [
            `## Reviews for ${slug}`,
            "",
        ];
        // Stats
        if (data.stats && typeof data.stats === "object") {
            const s = data.stats;
            lines.push("### Stats");
            if (s.avgRating !== undefined)
                lines.push(`Average rating: ${s.avgRating}/5`);
            if (s.totalReviews !== undefined)
                lines.push(`Total reviews: ${s.totalReviews}`);
            if (s.avgCliExperience !== undefined)
                lines.push(`Average CLI experience: ${s.avgCliExperience}/5`);
            if (s.avgSetupDifficulty !== undefined)
                lines.push(`Average setup difficulty: ${s.avgSetupDifficulty}/5`);
            if (s.avgDocsQuality !== undefined)
                lines.push(`Average docs quality: ${s.avgDocsQuality}/5`);
            if (s.recommendRate !== undefined)
                lines.push(`Recommend rate: ${s.recommendRate}%`);
            lines.push("");
        }
        // Integration stats
        if (data.integrationStats && typeof data.integrationStats === "object") {
            const is = data.integrationStats;
            if (Object.keys(is).length > 0) {
                lines.push("### Integration Stats");
                if (is.authSuccessRate !== undefined)
                    lines.push(`Auth success rate: ${is.authSuccessRate}%`);
                if (is.avgTimeToFirstRequest !== undefined)
                    lines.push(`Avg time to first request: ${is.avgTimeToFirstRequest} min`);
                if (is.headlessRate !== undefined)
                    lines.push(`Headless compatible rate: ${is.headlessRate}%`);
                lines.push("");
            }
        }
        // Reviews
        if (data.reviews.length === 0) {
            lines.push("No reviews yet for this API.");
        }
        else {
            lines.push(`### Reviews (${data.reviews.length} of ${data.total})\n`);
            for (const review of data.reviews) {
                const r = review;
                lines.push(`**${r.title}** - ${r.rating}/5 by ${r.reviewerName} (${r.reviewerType})`);
                if (r.body)
                    lines.push(String(r.body).slice(0, 300));
                lines.push(`CLI: ${r.cliExperience}/5 | Setup: ${r.setupDifficulty}/5 | Docs: ${r.docsQuality}/5 | Recommend: ${r.wouldRecommend ? "Yes" : "No"}`);
                if (r.integrationReport && typeof r.integrationReport === "object") {
                    const ir = r.integrationReport;
                    lines.push(`Integration: auth ${ir.authWorked ? "worked" : "failed"}, ${ir.timeToFirstRequest}min to first request, headless: ${ir.workedHeadless ? "yes" : "no"}`);
                    if (Array.isArray(ir.strengths) && ir.strengths.length) {
                        lines.push(`Strengths: ${ir.strengths.join(", ")}`);
                    }
                    if (Array.isArray(ir.challenges) && ir.challenges.length) {
                        lines.push(`Challenges: ${ir.challenges.join(", ")}`);
                    }
                }
                lines.push("");
            }
        }
        return textResult(lines.join("\n"));
    }
    catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
// ---------- Helpers ----------
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
function formatKey(key) {
    return key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
}
// ---------- Start ----------
const MODE = process.env.MCP_TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "8080", 10);
async function startStdio() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
async function startHttp() {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const httpServer = createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${PORT}`);
        // CORS headers for all responses
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
        res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        // Health check
        if (url.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
        }
        // Server card for Smithery scanning
        if (url.pathname === "/.well-known/mcp/server-card.json") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                serverInfo: {
                    name: "clirank",
                    version: "0.2.0",
                },
                authentication: { required: false },
                tools: [
                    { name: "discover_apis", description: "Search for APIs by intent or capability", inputSchema: { type: "object", properties: { query: { type: "string" }, min_cli_score: { type: "number" }, pricing: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
                    { name: "get_api_details", description: "Get full details for a specific API by slug", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
                    { name: "get_api_docs", description: "Get agent-friendly documentation for an API", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
                    { name: "compare_apis", description: "Compare two or more APIs side by side", inputSchema: { type: "object", properties: { slugs: { type: "array", items: { type: "string" } } }, required: ["slugs"] } },
                    { name: "browse_categories", description: "List all API categories", inputSchema: { type: "object", properties: {} } },
                    { name: "get_reviews", description: "Get integration reports and reviews for an API", inputSchema: { type: "object", properties: { slug: { type: "string" }, limit: { type: "number" } }, required: ["slug"] } },
                ],
                resources: [],
                prompts: [],
            }));
            return;
        }
        // MCP endpoint - all methods handled by transport
        if (url.pathname === "/mcp") {
            try {
                await transport.handleRequest(req, res);
            }
            catch (err) {
                console.error("MCP request error:", err);
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "internal_error", message: String(err) }));
                }
            }
            return;
        }
        // Redirect root to website
        if (url.pathname === "/") {
            res.writeHead(302, { Location: "https://clirank.dev" });
            res.end();
            return;
        }
        res.writeHead(404);
        res.end("Not found");
    });
    httpServer.listen(PORT, () => {
        console.log(`CLIRank MCP server (HTTP) listening on port ${PORT}`);
        console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    });
}
async function main() {
    if (MODE === "http") {
        await startHttp();
    }
    else {
        await startStdio();
    }
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map