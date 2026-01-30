import * as z from "zod/v4";

const SafeSearchSchema = z.enum(["off", "moderate", "strict"]);
const SearchModeSchema = z.enum(["fast", "balanced", "high"]);
const FetchModeSchema = z.enum(["auto", "http", "rendered"]);

export type SafeSearch = z.infer<typeof SafeSearchSchema>;
export type SearchMode = z.infer<typeof SearchModeSchema>;
export type FetchMode = z.infer<typeof FetchModeSchema>;

const EnvSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),

  MCP_PATH: z.string().default("/mcp"),

  TOOL_PREFIX: z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      if (!trimmed) return "sxng";
      const normalized = trimmed.toLowerCase();
      if (normalized === "none" || normalized === "off" || normalized === "false") return "";
      return trimmed;
    })
    .default("sxng"),

  ENABLE_LEGACY_TOOL_NAMES: z
    .string()
    .optional()
    .transform((v) => v === "1" || v?.toLowerCase() === "true")
    .default(false),

  API_KEYS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    ),

  ALLOWED_HOSTS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean)
        : undefined
    ),

  SEARXNG_BASE_URL: z.string().url().default("http://localhost:8080"),
  SEARCH_DEFAULT_LANG: z.string().default("ja"),
  SEARCH_DEFAULT_SAFE: SafeSearchSchema.default("moderate"),

  SEARCH_CACHE_TTL_MS: z.coerce.number().int().min(0).default(5 * 60_000),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).default(2_000),

  FETCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(12_000),
  FETCH_MAX_BYTES: z.coerce.number().int().min(10_000).default(2_000_000),
  FETCH_MAX_CHARS: z.coerce.number().int().min(100).default(12_000),

  RENDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(20_000),
  ENABLE_RENDERED_FETCH: z
    .string()
    .optional()
    .transform((v) => v === "1" || v?.toLowerCase() === "true")
    .default(false),

  AGENT_BROWSER_BIN: z.string().default("agent-browser"),

  TECH_DOMAIN_BOOST: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean)
        : [
            "developer.mozilla.org",
            "docs.microsoft.com",
            "learn.microsoft.com",
            "docs.oracle.com",
            "cloudflare.com",
            "kubernetes.io",
            "nodejs.org",
            "python.org",
            "pypi.org",
            "npmjs.com",
            "github.com",
            "gitlab.com",
            "stackoverflow.com"
          ]
    )
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }
  return parsed.data;
}

export const SearchMode = SearchModeSchema;
export const SafeSearch = SafeSearchSchema;
export const FetchMode = FetchModeSchema;
