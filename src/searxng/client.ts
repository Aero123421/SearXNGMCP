import { setTimeout as delay } from "node:timers/promises";

export type SearxngSearchParams = {
  query: string;
  page: number;
  language: string;
  safesearch: 0 | 1 | 2;
  categories?: string[];
  timeRange?: string;
  engines?: string[];
};

export type SearxngResult = {
  url: string;
  title: string;
  content?: string;
  engine?: string;
  engines?: string[];
  score?: number;
  publishedDate?: string;
  img_src?: string;
  thumbnail_src?: string;
};

export type SearxngSearchResponse = {
  results: SearxngResult[];
};

export class SearxngClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      timeoutMs: number;
      userAgent?: string;
      maxRetries?: number;
      backoffMs?: number;
    }
  ) {}

  async search(params: SearxngSearchParams): Promise<SearxngSearchResponse> {
    const url = new URL("/search", this.options.baseUrl);
    url.searchParams.set("format", "json");
    url.searchParams.set("q", params.query);
    url.searchParams.set("pageno", String(params.page));
    url.searchParams.set("language", params.language);
    url.searchParams.set("safesearch", String(params.safesearch));
    if (params.categories && params.categories.length > 0) {
      url.searchParams.set("categories", params.categories.join(","));
    }
    if (params.timeRange) {
      url.searchParams.set("time_range", params.timeRange);
    }
    if (params.engines && params.engines.length > 0) {
      url.searchParams.set("engines", params.engines.join(","));
    }

    const maxRetries = this.options.maxRetries ?? 1;
    const backoffMs = this.options.backoffMs ?? 200;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "user-agent": this.options.userAgent ?? "mcp-websearch/0.1"
          }
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `SearXNG error ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
          );
        }

        const data = (await res.json()) as unknown;
        if (!data || typeof data !== "object") {
          throw new Error("SearXNG response is not an object");
        }

        const results = Array.isArray((data as any).results) ? (data as any).results : [];
        return { results };
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await delay(backoffMs * (attempt + 1));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("SearXNG request failed");
  }
}
