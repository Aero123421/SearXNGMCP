import type { Logger } from "pino";
import * as z from "zod/v4";
import type { Express, NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  loadConfig,
  SafeSearch as SafeSearchSchema,
  SearchMode as SearchModeSchema,
  type FetchMode,
  type SafeSearch
} from "../config/env.js";
import { MemoryCache } from "../cache/memoryCache.js";
import { FixedWindowRateLimiter } from "../security/fixedWindowRateLimiter.js";
import { safeEqual } from "../security/timingSafeEqual.js";
import { SearxngClient } from "../searxng/client.js";
import { rerank, type RankedSearchResult } from "../search/rank.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { WebFetcher } from "../web/fetch.js";
import { asyncPool } from "../util/asyncPool.js";
import { randomUUID } from "node:crypto";
import { detectLanguageForQuery } from "../search/detectLanguage.js";
import { detectIntent, intentBoostDomains } from "../search/intent.js";

type CreateServerResult = {
  url: string;
  close: () => Promise<void>;
};

type AuthContext = {
  token: string;
};

function parseBearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return undefined;
  const token = match[1]?.trim();
  return token || undefined;
}

function getClientIp(req: Request): string | undefined {
  const cfIp = req.header("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xff = req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim();
  return req.socket.remoteAddress ?? undefined;
}

function safeSearchToSearxValue(safe: SafeSearch): 0 | 1 | 2 {
  switch (safe) {
    case "off":
      return 0;
    case "moderate":
      return 1;
    case "strict":
      return 2;
  }
  const exhaustive: never = safe;
  throw new Error(`Unknown safe_search: ${exhaustive}`);
}

function createAuthMiddleware(params: {
  allowedTokens: string[];
  logger: Logger;
}): (req: Request, res: Response, next: NextFunction) => void {
  const allowed = params.allowedTokens;
  return (req, res, next) => {
    if (req.path === "/healthz") return next();

    const token = parseBearerToken(req);
    if (!token) {
      res
        .status(401)
        .setHeader("www-authenticate", 'Bearer realm="mcp-websearch"')
        .json({ error: "missing bearer token" });
      return;
    }

    const ok = allowed.some((t) => safeEqual(t, token));
    if (!ok) {
      res.status(403).json({ error: "invalid token" });
      return;
    }

    res.locals.auth = { token } satisfies AuthContext;
    next();
  };
}

function createRateLimitMiddleware(params: {
  perMinuteLimit: number;
  perDayLimit: number;
  logger: Logger;
  perMinute: FixedWindowRateLimiter;
  perDay: FixedWindowRateLimiter;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (req.path === "/healthz") return next();

    const auth = res.locals.auth as AuthContext | undefined;
    const identity = auth?.token ?? getClientIp(req) ?? "anonymous";

    const minute = params.perMinute.consume({
      key: `m:${identity}`,
      limit: params.perMinuteLimit,
      windowMs: 60_000
    });
    if (!minute.allowed) {
      res.status(429).json({ error: "rate limited (per minute)" });
      return;
    }

    const day = params.perDay.consume({
      key: `d:${identity}`,
      limit: params.perDayLimit,
      windowMs: 24 * 60 * 60_000
    });
    if (!day.allowed) {
      res.status(429).json({ error: "rate limited (per day)" });
      return;
    }

    next();
  };
}

function buildMcpServer(params: {
  logger: Logger;
  config: ReturnType<typeof loadConfig>;
  searx: SearxngClient;
  searchCache: MemoryCache<{
    intent?: string;
    language?: string;
    results: RankedSearchResult[];
    nextCursor?: string;
  }>;
  fetcher: WebFetcher;
  fetchCache: MemoryCache<{ title?: string; contentText: string }>;
}): McpServer {
  const server = new McpServer(
    {
      name: "sxng-mcp",
      version: "0.1.0"
    },
    { capabilities: { logging: {} } }
  );

  const toolPrefix = params.config.TOOL_PREFIX;
  const enableLegacyToolNames = params.config.ENABLE_LEGACY_TOOL_NAMES;
  const toolName = (name: string): string => (toolPrefix ? `${toolPrefix}_${name}` : name);

  const registerTool = (baseName: string, spec: any, handler: any): void => {
    const primary = toolName(baseName);
    server.registerTool(primary, spec, handler);

    if (enableLegacyToolNames && primary !== baseName) {
      server.registerTool(
        baseName,
        {
          ...spec,
          title: `${spec.title} (legacy)`,
          description: `${spec.description ?? ""}\n\n(legacy alias: prefer ${primary})`.trim()
        },
        handler
      );
    }
  };

  registerTool(
    "web_search",
    {
      title: "Web Search",
      description:
        "Web検索を実行して結果リストを返します。mode=balanced/high は上位結果の本文取得で品質を改善します。",
      inputSchema: {
        query: z.string().min(1).describe("検索クエリ"),
        limit: z.number().int().min(1).max(50).default(10).describe("返す件数"),
        cursor: z.string().optional().describe("ページング用カーソル"),
        lang: z.string().optional().describe("言語コード (例: ja, en) / auto"),
        safe: SafeSearchSchema.default(params.config.SEARCH_DEFAULT_SAFE).describe(
          "セーフサーチ"
        ),
        mode: SearchModeSchema.default("fast").describe("fast|balanced|high"),
        categories: z.array(z.string()).optional().describe("SearXNG categories (任意)"),
        time_range: z.string().optional().describe("SearXNG time_range (任意)"),
        engines: z.array(z.string()).optional().describe("SearXNG engines (任意)"),
        tech_bias: z.boolean().optional().describe("技術系ドメイン優先を強める（未指定なら自動）"),
        include_domains: z.array(z.string()).optional(),
        exclude_domains: z.array(z.string()).optional()
      },
      outputSchema: {
        intent: z.string().optional(),
        language: z.string().optional(),
        results: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string().optional(),
            source: z.string().optional(),
            score: z.number(),
            domain: z.string().optional(),
            verified: z.boolean().optional()
          })
        ),
        nextCursor: z.string().optional()
      }
    },
    async (args: any) => {
      const {
        query,
        limit,
        cursor,
        lang,
        safe,
        mode,
        categories,
        time_range,
        engines,
        tech_bias,
        include_domains,
        exclude_domains
      } = args as any;
      const page = cursor ? decodeCursor(cursor).page : 1;
      const intent = detectIntent(query);
      const language =
        lang === "auto"
          ? detectLanguageForQuery(query)
          : lang ?? params.config.SEARCH_DEFAULT_LANG;
      const safesearch = safeSearchToSearxValue(safe);
      const techBias =
        tech_bias ?? (intent === "tech" || intent === "hardware");

      const cacheKey = JSON.stringify({
        q: query,
        page,
        language,
        safesearch,
        categories,
        time_range,
        engines,
        techBias,
        include_domains,
        exclude_domains,
        mode
      });

      const cached = params.searchCache.get(cacheKey);
      if (cached) {
        return {
          structuredContent: cached,
          content: [
            {
              type: "text",
              text: cached.results
                .map((r, i) => `${i + 1}. ${r.title}\n${r.url}`)
                .join("\n\n")
            }
          ]
        };
      }

      const searxResp = await params.searx.search({
        query,
        page,
        language,
        safesearch,
        categories,
        timeRange: time_range,
        engines
      });

      const raw = searxResp.results.map((r) => ({
        title: String((r as any).title ?? ""),
        url: String((r as any).url ?? ""),
        snippet: typeof (r as any).content === "string" ? (r as any).content : undefined,
        source:
          typeof (r as any).engine === "string"
            ? (r as any).engine
            : Array.isArray((r as any).engines)
              ? String((r as any).engines[0] ?? "")
              : undefined,
        rawScore: typeof (r as any).score === "number" ? (r as any).score : undefined
      }));

      const ranked = rerank({
        query,
        results: raw.filter((r) => r.title && r.url),
        techDomainBoost: techBias ? params.config.TECH_DOMAIN_BOOST : [],
        extraBoostDomains: intentBoostDomains(intent),
        includeDomains: include_domains,
        excludeDomains: exclude_domains
      });

      const top = ranked.slice(0, limit);

      const verifyTopK = mode === "high" ? Math.min(3, top.length) : mode === "balanced" ? Math.min(1, top.length) : 0;
      const fetchMode: FetchMode = mode === "high" ? "auto" : "http";

      const verified = await asyncPool({
        items: top.map((r, idx) => ({ ...r, idx })).slice(0, verifyTopK),
        concurrency: 2,
        mapper: async (item) => {
          const fetchKey = `fetch:${item.url}`;
          const cachedFetch = params.fetchCache.get(fetchKey);

          const fetched =
            cachedFetch ??
            (await params.fetcher
              .fetch({
                url: item.url,
                mode: fetchMode,
                maxChars: params.config.FETCH_MAX_CHARS
              })
              .then((r) => ({ title: r.title, contentText: r.contentText }))
              .catch((error) => {
                params.logger.warn({ url: item.url, error }, "verify fetch failed");
                return undefined;
              }));

          if (!fetched) return { idx: item.idx, snippet: item.snippet, title: item.title, verified: false };
          params.fetchCache.set(fetchKey, fetched);

          const improvedSnippet = fetched.contentText
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 280);

          return {
            idx: item.idx,
            title: fetched.title ?? item.title,
            snippet: improvedSnippet || item.snippet,
            verified: true
          };
        }
      });

      for (const v of verified) {
        const target = top[v.idx];
        if (!target) continue;
        if (v.title) target.title = v.title;
        if (v.snippet) target.snippet = v.snippet;
        (target as any).verified = v.verified;
      }

      const nextCursor =
        searxResp.results.length > 0 ? encodeCursor({ page: page + 1 }) : undefined;

      const payload = { intent, language, results: top, nextCursor };
      params.searchCache.set(cacheKey, payload);

      return {
        structuredContent: payload,
        content: [
          {
            type: "text",
            text: top.map((r, i) => `${i + 1}. ${r.title}\n${r.url}`).join("\n\n")
          }
        ]
      };
    }
  );

  registerTool(
    "web_image_search",
    {
      title: "Web Image Search",
      description: "画像検索を実行して画像URLを返します。",
      inputSchema: {
        query: z.string().min(1).describe("検索クエリ"),
        limit: z.number().int().min(1).max(50).default(10),
        cursor: z.string().optional(),
        lang: z.string().optional().describe("言語コード / auto"),
        safe: SafeSearchSchema.default(params.config.SEARCH_DEFAULT_SAFE),
        engines: z.array(z.string()).optional()
      },
      outputSchema: {
        results: z.array(
          z.object({
            title: z.string(),
            imageUrl: z.string(),
            thumbnailUrl: z.string().optional(),
            sourcePageUrl: z.string().optional(),
            source: z.string().optional(),
            score: z.number().optional(),
            domain: z.string().optional()
          })
        ),
        nextCursor: z.string().optional()
      }
    },
    async (args: any) => {
      const { query, limit, cursor, lang, safe, engines } = args as any;
      const page = cursor ? decodeCursor(cursor).page : 1;
      const language =
        lang === "auto"
          ? detectLanguageForQuery(query)
          : lang ?? params.config.SEARCH_DEFAULT_LANG;
      const safesearch = safeSearchToSearxValue(safe);

      const searxResp = await params.searx.search({
        query,
        page,
        language,
        safesearch,
        categories: ["images"],
        engines
      });

      const results = searxResp.results
        .map((r) => ({
          title: String((r as any).title ?? "").trim() || "(untitled)",
          imageUrl: String((r as any).img_src ?? (r as any).thumbnail_src ?? "").trim(),
          thumbnailUrl:
            typeof (r as any).thumbnail_src === "string" ? (r as any).thumbnail_src : undefined,
          sourcePageUrl: typeof (r as any).url === "string" ? (r as any).url : undefined,
          source:
            typeof (r as any).engine === "string"
              ? (r as any).engine
              : Array.isArray((r as any).engines)
                ? String((r as any).engines[0] ?? "")
                : undefined,
          score: typeof (r as any).score === "number" ? (r as any).score : undefined,
          domain:
            typeof (r as any).url === "string"
              ? (() => {
                  try {
                    return new URL((r as any).url).hostname;
                  } catch {
                    return undefined;
                  }
                })()
              : undefined
        }))
        .filter((r) => r.imageUrl)
        .slice(0, limit);

      const nextCursor =
        searxResp.results.length > 0 ? encodeCursor({ page: page + 1 }) : undefined;

      return {
        structuredContent: { results, nextCursor },
        content: [
          {
            type: "text",
            text: results.map((r, i) => `${i + 1}. ${r.title}\n${r.imageUrl}`).join("\n\n")
          }
        ]
      };
    }
  );

  registerTool(
    "web_research",
    {
      title: "Web Research",
      description:
        "複数クエリで検索を回し、結果を統合して返します（要約は行わず、根拠となるURL/本文テキストを返します）。",
      inputSchema: {
        question: z.string().min(1),
        maxQueries: z.number().int().min(1).max(5).default(3),
        perQueryLimit: z.number().int().min(1).max(10).default(5),
        fetchTopK: z.number().int().min(0).max(3).default(0),
        fetchMode: z.enum(["http", "auto", "rendered"]).default("http"),
        lang: z.string().optional().describe("言語コード / auto"),
        safe: SafeSearchSchema.default(params.config.SEARCH_DEFAULT_SAFE)
      },
      outputSchema: {
        queries: z.array(
          z.object({
            query: z.string(),
            results: z.array(
              z.object({
                title: z.string(),
                url: z.string(),
                snippet: z.string().optional(),
                source: z.string().optional(),
                score: z.number(),
                domain: z.string().optional()
              })
            )
          })
        ),
        finalResults: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string().optional(),
            source: z.string().optional(),
            score: z.number(),
            domain: z.string().optional()
          })
        ),
        documents: z.array(
          z.object({
            url: z.string(),
            finalUrl: z.string(),
            title: z.string().optional(),
            contentText: z.string(),
            contentHash: z.string(),
            retrievedAt: z.string(),
            mode: z.enum(["http", "auto", "rendered"])
          })
        )
      }
    },
    async (args: any) => {
      const { question, maxQueries, perQueryLimit, fetchTopK, fetchMode, lang, safe } = args as any;
      const intent = detectIntent(question);
      const language =
        lang === "auto"
          ? detectLanguageForQuery(question)
          : lang ?? params.config.SEARCH_DEFAULT_LANG;
      const safesearch = safeSearchToSearxValue(safe);

      const baseQueries: string[] = [question];
      if (maxQueries > 1) {
        if (intent === "tech" || intent === "hardware") {
          baseQueries.push(
            language === "ja" ? `${question} 公式 ドキュメント` : `${question} official documentation`
          );
        } else if (intent === "history") {
          baseQueries.push(language === "ja" ? `${question} 年表` : `${question} timeline`);
        } else {
          baseQueries.push(language === "ja" ? `${question} とは` : `${question} explained`);
        }
      }
      if (maxQueries > 2) {
        if (intent === "tech") baseQueries.push(`${question} site:github.com`);
        else if (intent === "history") baseQueries.push(`${question} site:wikipedia.org`);
        else baseQueries.push(`${question} site:wikipedia.org`);
      }

      const queries = baseQueries.slice(0, maxQueries);

      const perQueryResults: Array<{ query: string; results: RankedSearchResult[] }> = [];
      const all: RankedSearchResult[] = [];

      for (const q of queries) {
        const resp = await params.searx.search({
          query: q,
          page: 1,
          language,
          safesearch
        });
        const raw = resp.results.map((r) => ({
          title: String((r as any).title ?? ""),
          url: String((r as any).url ?? ""),
          snippet: typeof (r as any).content === "string" ? (r as any).content : undefined,
          source:
            typeof (r as any).engine === "string"
              ? (r as any).engine
              : Array.isArray((r as any).engines)
                ? String((r as any).engines[0] ?? "")
                : undefined,
          rawScore: typeof (r as any).score === "number" ? (r as any).score : undefined
        }));

        const ranked = rerank({
          query: q,
          results: raw.filter((r) => r.title && r.url),
          techDomainBoost:
            intent === "tech" || intent === "hardware" ? params.config.TECH_DOMAIN_BOOST : [],
          extraBoostDomains: intentBoostDomains(intent)
        }).slice(0, perQueryLimit);

        perQueryResults.push({ query: q, results: ranked });
        all.push(...ranked);
      }

      // de-dup by url (rerank already normalizes and drops dup per-query; but across queries we unify)
      const byUrl = new Map<string, RankedSearchResult>();
      for (const r of all) {
        const existing = byUrl.get(r.url);
        if (!existing || r.score > existing.score) byUrl.set(r.url, r);
      }

      const finalResults = Array.from(byUrl.values()).sort((a, b) => b.score - a.score).slice(0, 20);

      const documents =
        fetchTopK > 0
          ? await asyncPool({
              items: finalResults.slice(0, fetchTopK),
              concurrency: 2,
              mapper: async (r) => {
                const fetched = await params.fetcher.fetch({
                  url: r.url,
                  mode: fetchMode,
                  maxChars: params.config.FETCH_MAX_CHARS
                });
                return {
                  url: fetched.url,
                  finalUrl: fetched.finalUrl,
                  title: fetched.title,
                  contentText: fetched.contentText,
                  contentHash: fetched.contentHash,
                  retrievedAt: fetched.retrievedAt,
                  mode: fetchMode
                };
              }
            })
          : [];

      const payload = { queries: perQueryResults, finalResults, documents };
      return {
        structuredContent: payload,
        content: [
          {
            type: "text",
            text: finalResults.map((r, i) => `${i + 1}. ${r.title}\n${r.url}`).join("\n\n")
          }
        ]
      };
    }
  );

  registerTool(
    "web_fetch",
    {
      title: "Web Fetch",
      description: "指定URLの本文テキストを取得します。mode=rendered はヘッドレスで描画後に抽出します。",
      inputSchema: {
        url: z.string().min(1),
        mode: z.enum(["auto", "http", "rendered"]).default("auto"),
        maxChars: z.number().int().min(100).max(100_000).optional()
      },
      outputSchema: {
        url: z.string(),
        finalUrl: z.string(),
        title: z.string().optional(),
        contentText: z.string(),
        truncated: z.boolean(),
        contentHash: z.string(),
        retrievedAt: z.string(),
        mode: z.enum(["auto", "http", "rendered"])
      }
    },
    async (args: any) => {
      const { url, mode, maxChars } = args as any;
      const result = await params.fetcher.fetch({ url, mode, maxChars });
      const payload = {
        url: result.url,
        finalUrl: result.finalUrl,
        title: result.title,
        contentText: result.contentText,
        truncated: result.truncated,
        contentHash: result.contentHash,
        retrievedAt: result.retrievedAt,
        mode
      };
      return {
        structuredContent: payload,
        content: [
          {
            type: "text",
            text: `${payload.title ? `${payload.title}\n` : ""}${payload.finalUrl}\n\n${payload.contentText}`
          }
        ]
      };
    }
  );

  return server;
}

function registerHealthz(app: Express): void {
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });
}

export async function createWebSearchMcpServer(params: {
  logger: Logger;
}): Promise<CreateServerResult> {
  const config = loadConfig();

  const app = createMcpExpressApp({
    host: config.HOST,
    allowedHosts: config.ALLOWED_HOSTS
  });

  registerHealthz(app);

  const auth = createAuthMiddleware({ allowedTokens: config.API_KEYS, logger: params.logger });
  const perMinute = new FixedWindowRateLimiter();
  const perDay = new FixedWindowRateLimiter();
  const rateLimit = createRateLimitMiddleware({
    perMinuteLimit: config.RATE_LIMIT_PER_MINUTE,
    perDayLimit: config.RATE_LIMIT_PER_DAY,
    logger: params.logger,
    perMinute,
    perDay
  });

  app.use(auth);
  app.use(rateLimit);

  const searx = new SearxngClient({
    baseUrl: config.SEARXNG_BASE_URL,
    timeoutMs: 8_000,
    userAgent: "mcp-websearch/0.1",
    maxRetries: 1
  });

  const searchCache = new MemoryCache<{
    intent?: string;
    language?: string;
    results: RankedSearchResult[];
    nextCursor?: string;
  }>({
    maxEntries: 5_000,
    ttlMs: config.SEARCH_CACHE_TTL_MS
  });

  const fetchCache = new MemoryCache<{ title?: string; contentText: string }>({
    maxEntries: 20_000,
    ttlMs: 12 * 60 * 60_000
  });

  const fetcher = new WebFetcher(
    {
      userAgent: "mcp-websearch/0.1",
      httpTimeoutMs: config.FETCH_TIMEOUT_MS,
      httpMaxBytes: config.FETCH_MAX_BYTES,
      maxChars: config.FETCH_MAX_CHARS,
      renderedTimeoutMs: config.RENDER_TIMEOUT_MS,
      enableRenderedFetch: config.ENABLE_RENDERED_FETCH,
      agentBrowserBin: config.AGENT_BROWSER_BIN
    },
    params.logger
  );

  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer; createdAt: number }
  >();

  app.post(config.MCP_PATH, async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    try {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          res.status(404).json({ error: "unknown session" });
          return;
        }
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: missing session id (initialize required)"
          },
          id: null
        });
        return;
      }

      const server = buildMcpServer({
        logger: params.logger,
        config,
        searx,
        searchCache,
        fetcher,
        fetchCache
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, server, createdAt: Date.now() });
        }
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      params.logger.error({ error }, "mcp request failed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    }
  });

  app.get(config.MCP_PATH, async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId) {
      res.status(400).send("Missing mcp-session-id");
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).send("Unknown session");
      return;
    }
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      params.logger.error({ error }, "mcp get failed");
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  app.delete(config.MCP_PATH, async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId) {
      res.status(400).send("Missing mcp-session-id");
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).send("Unknown session");
      return;
    }
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      params.logger.error({ error }, "mcp delete failed");
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  const server = app.listen(config.PORT, config.HOST);
  const url = `http://${config.HOST}:${config.PORT}${config.MCP_PATH}`;

  return {
    url,
    close: async () => {
      for (const session of sessions.values()) {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}
