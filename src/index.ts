#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";

// ---------- Config ----------

const BASE_URL = process.env.CLIRANK_API_URL || "https://clirank.dev/api";

// ---------- HTTP helpers ----------

async function apiGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "clirank-mcp/0.4.0" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CLIRank API ${res.status}: ${body || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

// ---------- Response types ----------

interface DiscoverResult {
  name: string;
  slug: string;
  category: string;
  subcategory: string;
  description: string;
  url: string;
  pricing: string;
  npmPackage: string | null;
  cliRelevanceScore: number | null;
  qualityScore: number | null;
  capabilities: string[];
  relevanceScore: number;
  matchSource: string;
  reviewMentions: number;
  agentDocs: { hasQuickstart: boolean; endpointCount: number; avgConfidence: number };
  decisionData?: {
    costAt10k: number;
    costAt50k: number;
    costAt100k: number;
    timeToFirstRequest: number;
    linesOfCode: number;
    freeRequestsPerMonth: number;
    requiresCreditCard: boolean;
    bestFor: string[];
  };
  detailUrl: string;
}

interface DiscoverResponse {
  query: string;
  count: number;
  results: DiscoverResult[];
  hint?: string;
}

interface ApiRecord {
  name: string;
  category: string;
  subcategory: string;
  description: string;
  url: string;
  pricing: string;
  npmPackage: string | null;
  weeklyDownloads: number | null;
  cliRelevanceScore: number | null;
  qualityScore: number | null;
  overallScore: number | null;
  cliBreakdown: Record<string, boolean> | null;
  qualityBreakdown: Record<string, unknown> | null;
  capabilities: string[];
  dataTypes: string[];
}

interface ApisResponse {
  count: number;
  categories: { name: string; slug: string; count: number }[];
  apis: ApiRecord[];
}

interface DocsResponse {
  api: {
    name: string;
    slug: string;
    url: string;
    pricing: string;
    category: string;
    cliRelevanceScore: number | null;
    qualityScore: number | null;
  };
  quickstart: Record<string, unknown> | null;
  endpoints: Array<{
    method: string;
    path: string;
    summary: string | null;
    confidence: number;
    contributionCount: number;
  }>;
  totalEndpoints: number;
}

interface PackageResponse {
  name: string;
  registry: string;
  latestVersion: string | null;
  versions: string[];
  engines: Record<string, string> | null;
  pythonRequires: string | null;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  lastPublishDate: string | null;
  weeklyDownloads: number | null;
  monthlyDownloads: number | null;
  license: string | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  deprecated: string | null;
  description: string | null;
  keywords: string[];
  typescriptTypes: string | null;
  cachedAt: string;
  clirankApiSlug: string | null;
  freshness: string;
}

interface ReviewsResponse {
  target: { type: string; slug: string };
  stats: Record<string, unknown>;
  integrationStats: Record<string, unknown>;
  total: number;
  reviews: Array<Record<string, unknown>>;
}

interface RecommendResponse {
  task: string;
  volume: number;
  budget: number | null;
  priority: string;
  constraints: string[];
  recommendation: {
    name: string;
    slug: string;
    url: string;
    score: number;
    reasoning: string[];
    monthlyCost: number;
    bestFor: string[];
    notGreatFor: string[];
    setup: {
      timeToFirstRequest: number;
      linesOfCode: number;
      requiresDomainVerification: boolean;
      requiresCreditCard: boolean;
    };
    pricing: {
      freeRequestsPerMonth: number;
      costAt10k: number;
      costAt50k: number;
      costAt100k: number;
      tiers: Array<{ name: string; monthlyEmails: number; pricePerMonth: number }>;
    };
    features: {
      supportsInbound: boolean;
      hasTemplateEngine: boolean;
      webhookSupport: boolean;
    };
    quickstart: {
      language: string;
      code: string;
    };
    lastVerified: string;
    detailUrl: string;
  } | null;
  runnerUp: {
    name: string;
    slug: string;
    score: number;
    reasoning: string[];
    monthlyCost: number;
    quickstart: { language: string; code: string };
    detailUrl: string;
  } | null;
  comparison: string;
  meta: {
    apisEvaluated: number;
    categoriesWithDecisionData: string[];
    hint: string;
  };
  message?: string;
}

// ---------- MCP Server ----------

const server = new McpServer({
  name: "clirank",
  version: "0.4.0",
});

// Tool 1: discover_apis
server.tool(
  "discover_apis",
  "Search for APIs by what you need. Returns ranked matches with pricing and setup data when available. For an opinionated pick with working code, use the recommend tool instead. Examples: 'send transactional emails', 'process payments', 'image generation'.",
  {
    query: z.string().describe("What you need, e.g. 'send transactional emails'"),
    min_cli_score: z.number().min(1).max(10).optional().describe("Minimum CLI relevance score (1-10)"),
    pricing: z.enum(["free", "freemium", "paid", "pay-per-use", "transaction-based"]).optional().describe("Pricing filter"),
    limit: z.number().min(1).max(50).optional().describe("Max results (default 10, max 50)"),
  },
  async ({ query, min_cli_score, pricing, limit }) => {
    try {
      const params: Record<string, string> = { q: query };
      if (min_cli_score !== undefined) params.min_cli = String(min_cli_score);
      if (pricing) params.pricing = pricing;
      if (limit !== undefined) params.limit = String(limit);

      const data = await apiGet<DiscoverResponse>("/discover", params);

      if (data.count === 0) {
        return textResult(`No APIs found matching "${query}". Try broader terms or remove filters.`);
      }

      const lines = [`Found ${data.count} APIs matching "${query}":\n`];
      for (const r of data.results) {
        lines.push(`## ${r.name}`);
        lines.push(`Slug: ${r.slug} | Category: ${r.category}`);
        lines.push(`CLI Score: ${r.cliRelevanceScore ?? "N/A"} | Quality: ${r.qualityScore ?? "N/A"} | Pricing: ${r.pricing}`);
        lines.push(`${r.description}`);
        if (r.capabilities.length) lines.push(`Capabilities: ${r.capabilities.join(", ")}`);
        if (r.decisionData) {
          lines.push(`Setup: ${r.decisionData.timeToFirstRequest} min, ${r.decisionData.linesOfCode} lines of code`);
          lines.push(`Cost: $${r.decisionData.costAt10k}/mo (10K) | $${r.decisionData.costAt50k}/mo (50K) | $${r.decisionData.costAt100k}/mo (100K)`);
          if (r.decisionData.freeRequestsPerMonth > 0) lines.push(`Free tier: ${r.decisionData.freeRequestsPerMonth.toLocaleString()}/mo`);
          lines.push(`Best for: ${r.decisionData.bestFor.join(", ")}`);
        }
        if (r.agentDocs.hasQuickstart) lines.push(`Agent docs: quickstart available, ${r.agentDocs.endpointCount} endpoints documented`);
        lines.push(`Details: ${r.detailUrl}`);
        lines.push("");
      }

      if (data.hint) {
        lines.push(`---\nTip: ${data.hint}`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 2: get_api_details
server.tool(
  "get_api_details",
  "Get full details for a specific API by its slug. Returns scores, pricing, auth method, capabilities, and quality breakdown.",
  {
    slug: z.string().describe("API slug, e.g. 'stripe-api', 'openai-api'"),
  },
  async ({ slug }) => {
    try {
      // Fetch the API via the apis endpoint with name search
      const data = await apiGet<ApisResponse>("/apis", { q: slug, limit: "5" });

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
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 3: get_api_docs
server.tool(
  "get_api_docs",
  "Get agent-friendly documentation for an API, including quickstart guide and documented endpoints. Use this before integrating an API.",
  {
    slug: z.string().describe("API slug, e.g. 'stripe-api', 'openai-api'"),
  },
  async ({ slug }) => {
    try {
      const data = await apiGet<DocsResponse>("/docs", { slug });

      const lines = [
        `## ${data.api.name} - Agent Docs`,
        "",
        `Category: ${data.api.category} | Pricing: ${data.api.pricing}`,
        `CLI Score: ${data.api.cliRelevanceScore ?? "N/A"} | Quality: ${data.api.qualityScore ?? "N/A"}`,
        `URL: ${data.api.url}`,
        "",
      ];

      if (data.quickstart) {
        const qs = data.quickstart as Record<string, unknown>;
        lines.push("### Quickstart");
        if (qs.baseUrl) lines.push(`Base URL: ${qs.baseUrl}`);
        if (qs.officialDocsUrl) lines.push(`Official docs: ${qs.officialDocsUrl}`);

        if (qs.auth && typeof qs.auth === "object") {
          const auth = qs.auth as Record<string, unknown>;
          lines.push(`Auth: ${auth.method}${auth.header ? ` (${auth.header})` : ""}`);
          if (auth.envVar) lines.push(`Env var: ${auth.envVar}`);
        }

        if (qs.sdk && typeof qs.sdk === "object") {
          const sdk = qs.sdk as Record<string, unknown>;
          if (sdk.install) lines.push(`\nInstall: \`${sdk.install}\``);
          if (sdk.import) lines.push(`Import: \`${sdk.import}\``);
          if (sdk.init) lines.push(`Init: \`${sdk.init}\``);
        }

        if (Array.isArray(qs.requiredEnvVars) && qs.requiredEnvVars.length) {
          lines.push(`\nRequired env vars: ${qs.requiredEnvVars.join(", ")}`);
        }

        if (qs.rateLimits && typeof qs.rateLimits === "object") {
          const rl = qs.rateLimits as Record<string, unknown>;
          lines.push(`Rate limits: ${rl.requests ?? "?"} requests per ${rl.window ?? "?"}`);
        }

        if (Array.isArray(qs.gotchas) && qs.gotchas.length) {
          lines.push("\nGotchas:");
          for (const g of qs.gotchas) lines.push(`- ${g}`);
        }

        lines.push(`\nConfidence: ${qs.confidence ?? "N/A"} | Contributions: ${qs.contributionCount ?? 0}`);
        lines.push("");
      } else {
        lines.push("No quickstart documentation available yet.\n");
      }

      if (data.endpoints.length) {
        lines.push(`### Documented Endpoints (${data.totalEndpoints})\n`);
        for (const ep of data.endpoints) {
          lines.push(`- \`${ep.method} ${ep.path}\` - ${ep.summary || "No summary"} (confidence: ${ep.confidence})`);
        }
      } else {
        lines.push("No endpoint documentation available yet.");
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 4: compare_apis
server.tool(
  "compare_apis",
  "Compare two or more APIs side by side. Returns a comparison table with scores, pricing, auth, and capabilities.",
  {
    slugs: z.array(z.string()).min(2).max(5).describe("Array of API slugs to compare, e.g. ['stripe-api', 'paypal-api']"),
  },
  async ({ slugs }) => {
    try {
      // Fetch all APIs in parallel
      const results = await Promise.all(
        slugs.map(async (slug) => {
          const data = await apiGet<ApisResponse>("/apis", { q: slug, limit: "5" });
          const api = data.apis.find(a => slugify(a.name) === slug) || data.apis[0];
          return { slug, api: api || null };
        })
      );

      const missing = results.filter(r => !r.api).map(r => r.slug);
      if (missing.length) {
        return errorResult(`APIs not found: ${missing.join(", ")}. Use discover_apis to find valid slugs.`);
      }

      const apis = results.map(r => r.api!);
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
      } else {
        lines.push(`**Recommendation:** ${scored[0].name} and ${scored[1].name} score equally. Choose based on your specific requirements.`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 5: browse_categories
server.tool(
  "browse_categories",
  "List all API categories in the CLIRank directory with the number of APIs in each.",
  {},
  async () => {
    try {
      const data = await apiGet<ApisResponse>("/apis", { limit: "1" });

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
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 6: get_reviews
server.tool(
  "get_reviews",
  "Get integration reports and reviews for an API. Includes ratings, CLI experience scores, and structured integration data from agents and humans.",
  {
    slug: z.string().describe("API slug, e.g. 'openai-api'"),
    limit: z.number().min(1).max(100).optional().describe("Max reviews to return (default 10)"),
  },
  async ({ slug, limit }) => {
    try {
      const params: Record<string, string> = {
        target_type: "api",
        slug,
      };
      if (limit !== undefined) params.limit = String(limit);
      else params.limit = "10";

      const data = await apiGet<ReviewsResponse>("/reviews", params);

      const lines = [
        `## Reviews for ${slug}`,
        "",
      ];

      // Stats
      if (data.stats && typeof data.stats === "object") {
        const s = data.stats as Record<string, unknown>;
        lines.push("### Stats");
        if (s.avgRating !== undefined) lines.push(`Average rating: ${s.avgRating}/5`);
        if (s.totalReviews !== undefined) lines.push(`Total reviews: ${s.totalReviews}`);
        if (s.avgCliExperience !== undefined) lines.push(`Average CLI experience: ${s.avgCliExperience}/5`);
        if (s.avgSetupDifficulty !== undefined) lines.push(`Average setup difficulty: ${s.avgSetupDifficulty}/5`);
        if (s.avgDocsQuality !== undefined) lines.push(`Average docs quality: ${s.avgDocsQuality}/5`);
        if (s.recommendRate !== undefined) lines.push(`Recommend rate: ${s.recommendRate}%`);
        lines.push("");
      }

      // Integration stats
      if (data.integrationStats && typeof data.integrationStats === "object") {
        const is = data.integrationStats as Record<string, unknown>;
        if (Object.keys(is).length > 0) {
          lines.push("### Integration Stats");
          if (is.authSuccessRate !== undefined) lines.push(`Auth success rate: ${is.authSuccessRate}%`);
          if (is.avgTimeToFirstRequest !== undefined) lines.push(`Avg time to first request: ${is.avgTimeToFirstRequest} min`);
          if (is.headlessRate !== undefined) lines.push(`Headless compatible rate: ${is.headlessRate}%`);
          lines.push("");
        }
      }

      // Reviews
      if (data.reviews.length === 0) {
        lines.push("No reviews yet for this API.");
      } else {
        lines.push(`### Reviews (${data.reviews.length} of ${data.total})\n`);
        for (const review of data.reviews) {
          const r = review as Record<string, unknown>;
          lines.push(`**${r.title}** - ${r.rating}/5 by ${r.reviewerName} (${r.reviewerType})`);
          if (r.body) lines.push(String(r.body).slice(0, 300));
          lines.push(`CLI: ${r.cliExperience}/5 | Setup: ${r.setupDifficulty}/5 | Docs: ${r.docsQuality}/5 | Recommend: ${r.wouldRecommend ? "Yes" : "No"}`);

          if (r.integrationReport && typeof r.integrationReport === "object") {
            const ir = r.integrationReport as Record<string, unknown>;
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
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 7: recommend
server.tool(
  "recommend",
  "Get an opinionated API recommendation for a task. Returns ONE best pick with pricing, working quickstart code, setup time, and a runner-up. Better than guessing - uses verified pricing and setup data that's more current than your training data.",
  {
    task: z.string().describe("What you need, e.g. 'send transactional emails', 'process payments'"),
    volume: z.number().optional().describe("Monthly volume (default 10000)"),
    budget: z.number().optional().describe("Max monthly USD (0 = free tier only, omit for no limit)"),
    priority: z.enum(["cost", "simplicity", "deliverability", "scale"]).optional().describe("What matters most (default: simplicity)"),
    constraints: z.array(z.string()).optional().describe("Constraints: 'no-credit-card', 'no-domain-verification'"),
  },
  async ({ task, volume, budget, priority, constraints }) => {
    try {
      const params: Record<string, string> = { task };
      if (volume !== undefined) params.volume = String(volume);
      if (budget !== undefined) params.budget = String(budget);
      if (priority) params.priority = priority;
      if (constraints?.length) params.constraints = constraints.join(",");

      const data = await apiGet<RecommendResponse>("/recommend", params);

      if (!data.recommendation) {
        return textResult(
          `No APIs match your constraints for "${task}".\n` +
          (data.message || "Try relaxing budget or removing constraints.")
        );
      }

      const rec = data.recommendation;
      const lines = [
        `## Recommendation: ${rec.name}`,
        "",
        `**Why:** ${rec.reasoning.join(". ")}`,
        "",
        `### Pricing`,
        `Monthly cost at ${(data.volume).toLocaleString()} emails: **$${rec.monthlyCost.toFixed(2)}**`,
        `Free tier: ${rec.pricing.freeRequestsPerMonth.toLocaleString()} emails/mo`,
        `At scale: $${rec.pricing.costAt10k} (10K) | $${rec.pricing.costAt50k} (50K) | $${rec.pricing.costAt100k} (100K)`,
        "",
        `### Setup`,
        `Time to first request: ${rec.setup.timeToFirstRequest} min`,
        `Lines of code: ${rec.setup.linesOfCode}`,
        `Domain verification: ${rec.setup.requiresDomainVerification ? "Required" : "Not required"}`,
        `Credit card: ${rec.setup.requiresCreditCard ? "Required" : "Not required"}`,
        "",
        `### Quickstart (${rec.quickstart.language})`,
        "```" + rec.quickstart.language,
        rec.quickstart.code,
        "```",
        "",
        `Best for: ${rec.bestFor.join(", ")}`,
        `Not great for: ${rec.notGreatFor.join(", ")}`,
        "",
        `Features: inbound ${rec.features.supportsInbound ? "yes" : "no"} | templates ${rec.features.hasTemplateEngine ? "yes" : "no"} | webhooks ${rec.features.webhookSupport ? "yes" : "no"}`,
        `Last verified: ${rec.lastVerified}`,
        `Details: ${rec.detailUrl}`,
      ];

      if (data.runnerUp) {
        lines.push(
          "",
          `## Runner-up: ${data.runnerUp.name}`,
          `Score: ${data.runnerUp.score} | Cost: $${data.runnerUp.monthlyCost.toFixed(2)}/mo`,
          `Why: ${data.runnerUp.reasoning.join(". ")}`,
          `Details: ${data.runnerUp.detailUrl}`,
        );
      }

      if (data.comparison) {
        lines.push("", "### Full Comparison", "```", data.comparison, "```");
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// Tool 8: get_package_info
server.tool(
  "get_package_info",
  "Get current package version, compatibility, dependencies, and deprecation warnings for any npm or PyPI package. Faster and more current than checking registries manually. Auto-updates every 24h.",
  {
    name: z.string().describe("Package name, e.g. 'resend', '@anthropic-ai/sdk', 'openai'"),
    registry: z.enum(["npm", "pypi"]).optional().describe("Registry to check (default: npm)"),
  },
  async ({ name, registry }) => {
    try {
      const params: Record<string, string> = { name };
      if (registry) params.registry = registry;

      const data = await apiGet<PackageResponse>("/package", params);

      const lines = [
        `## ${data.name} (${data.registry})`,
        "",
        `**Latest version:** ${data.latestVersion || "unknown"}`,
      ];

      if (data.deprecated) {
        lines.push(`**DEPRECATED:** ${data.deprecated}`);
      }

      if (data.engines) {
        const engines = Object.entries(data.engines as Record<string, string>)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
        lines.push(`**Engines:** ${engines}`);
      }

      if (data.pythonRequires) {
        lines.push(`**Python:** ${data.pythonRequires}`);
      }

      if (data.license) lines.push(`**License:** ${data.license}`);
      if (data.typescriptTypes) lines.push(`**TypeScript:** ${data.typescriptTypes}`);
      if (data.weeklyDownloads) lines.push(`**Weekly downloads:** ${data.weeklyDownloads.toLocaleString()}`);
      if (data.lastPublishDate) lines.push(`**Last published:** ${data.lastPublishDate.split("T")[0]}`);
      if (data.description) lines.push(`**Description:** ${data.description}`);

      // Dependencies
      const deps = data.dependencies as Record<string, string> | undefined;
      if (deps && Object.keys(deps).length > 0) {
        const depList = Object.entries(deps).slice(0, 15);
        lines.push("", "**Dependencies:**");
        for (const [dep, ver] of depList) {
          lines.push(`- ${dep}: ${ver}`);
        }
        if (Object.keys(deps).length > 15) {
          lines.push(`- ... and ${Object.keys(deps).length - 15} more`);
        }
      }

      // Recent versions
      const versions = data.versions as string[] | undefined;
      if (versions && versions.length > 0) {
        lines.push("", `**Recent versions:** ${versions.slice(0, 10).join(", ")}`);
      }

      if (data.repositoryUrl) lines.push("", `**Repository:** ${data.repositoryUrl}`);
      if (data.clirankApiSlug) lines.push(`**CLIRank profile:** https://clirank.dev/api/${data.clirankApiSlug}`);

      lines.push("", `_Data freshness: ${data.freshness || "cached"}_`);

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
);

// ---------- Helpers ----------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ---------- Request Counter ----------

const startTime = new Date().toISOString();

const requestCounts: Record<string, { total: number; uniqueUAs: Set<string>; lastSeen: string }> = {};

function trackRequest(pathname: string, ua: string) {
  if (!requestCounts[pathname]) {
    requestCounts[pathname] = { total: 0, uniqueUAs: new Set(), lastSeen: "" };
  }
  requestCounts[pathname].total++;
  requestCounts[pathname].uniqueUAs.add(ua);
  requestCounts[pathname].lastSeen = new Date().toISOString();
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

    // Log all non-health requests
    if (url.pathname !== "/health") {
      const ua = req.headers["user-agent"] || "unknown";
      const ts = new Date().toISOString();
      console.log(`[${ts}] ${req.method} ${url.pathname} ua=${ua.slice(0, 80)}`);
    }

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
          version: "0.4.0",
        },
        authentication: { required: false },
        tools: [
          { name: "discover_apis", description: "Search for APIs by intent or capability", inputSchema: { type: "object", properties: { query: { type: "string" }, min_cli_score: { type: "number" }, pricing: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
          { name: "get_api_details", description: "Get full details for a specific API by slug", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
          { name: "get_api_docs", description: "Get agent-friendly documentation for an API", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
          { name: "compare_apis", description: "Compare two or more APIs side by side", inputSchema: { type: "object", properties: { slugs: { type: "array", items: { type: "string" } } }, required: ["slugs"] } },
          { name: "browse_categories", description: "List all API categories", inputSchema: { type: "object", properties: {} } },
          { name: "get_reviews", description: "Get integration reports and reviews for an API", inputSchema: { type: "object", properties: { slug: { type: "string" }, limit: { type: "number" } }, required: ["slug"] } },
          { name: "recommend", description: "Get an opinionated API recommendation with pricing and working quickstart code", inputSchema: { type: "object", properties: { task: { type: "string" }, volume: { type: "number" }, budget: { type: "number" }, priority: { type: "string", enum: ["cost", "simplicity", "deliverability", "scale"] }, constraints: { type: "array", items: { type: "string" } } }, required: ["task"] } },
          { name: "get_package_info", description: "Get current npm/PyPI package version, compatibility, dependencies, and deprecation warnings", inputSchema: { type: "object", properties: { name: { type: "string" }, registry: { type: "string", enum: ["npm", "pypi"] } }, required: ["name"] } },
        ],
        resources: [],
        prompts: [],
      }));
      return;
    }

    // Stats endpoint - see who's using the MCP server
    if (url.pathname === "/stats") {
      const stats = Object.entries(requestCounts).map(([path, data]) => ({
        path,
        totalRequests: data.total,
        uniqueClients: data.uniqueUAs.size,
        lastSeen: data.lastSeen,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ upSince: startTime, stats }));
      return;
    }

    // MCP endpoint - all methods handled by transport
    if (url.pathname === "/mcp") {
      const ua = req.headers["user-agent"] || "unknown";
      trackRequest("/mcp", ua);
      try {
        await transport.handleRequest(req, res);
      } catch (err) {
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
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
