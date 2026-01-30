import type { Logger } from "pino";
import type { FetchMode } from "../config/env.js";
import { PublicWebUrlPolicy } from "../security/urlPolicy.js";
import { fetchUrlAsText, type HttpFetchResult } from "./fetchHttp.js";
import { renderedFetchWithAgentBrowser, type RenderedFetchResult } from "./agentBrowserRenderedFetch.js";

export type WebFetchResult =
  | (HttpFetchResult & { mode: "http" | "auto" })
  | (RenderedFetchResult & { mode: "rendered" | "auto" });

export class WebFetcher {
  private readonly urlPolicy = new PublicWebUrlPolicy();

  constructor(
    private readonly config: {
      userAgent: string;
      httpTimeoutMs: number;
      httpMaxBytes: number;
      maxChars: number;
      renderedTimeoutMs: number;
      enableRenderedFetch: boolean;
      agentBrowserBin: string;
    },
    private readonly logger: Logger
  ) {}

  async fetch(params: {
    url: string;
    mode: FetchMode;
    maxChars?: number;
  }): Promise<WebFetchResult> {
    const maxChars = params.maxChars ?? this.config.maxChars;
    const url = new URL(params.url);
    await this.urlPolicy.assertAllowed(url);

    if (params.mode === "rendered") {
      if (!this.config.enableRenderedFetch) {
        throw new Error("rendered fetch is disabled (ENABLE_RENDERED_FETCH=false)");
      }
      const rendered = await renderedFetchWithAgentBrowser({
        bin: this.config.agentBrowserBin,
        url: url.toString(),
        timeoutMs: this.config.renderedTimeoutMs,
        maxChars
      });
      return { ...rendered, mode: "rendered" };
    }

    const http = await fetchUrlAsText({
      url: url.toString(),
      timeoutMs: this.config.httpTimeoutMs,
      maxBytes: this.config.httpMaxBytes,
      maxChars,
      userAgent: this.config.userAgent
    });

    if (params.mode === "http") return { ...http, mode: "http" };

    // auto mode: if extraction looks weak, optionally retry with rendered mode
    if (
      this.config.enableRenderedFetch &&
      http.contentText.trim().length < 400 &&
      (http.contentType?.includes("text/html") ?? true)
    ) {
      this.logger.info(
        { url: params.url },
        "auto fetch: weak http extraction, retrying with rendered fetch"
      );
      const rendered = await renderedFetchWithAgentBrowser({
        bin: this.config.agentBrowserBin,
        url: url.toString(),
        timeoutMs: this.config.renderedTimeoutMs,
        maxChars
      });
      return { ...rendered, mode: "auto" };
    }

    return { ...http, mode: "auto" };
  }
}

