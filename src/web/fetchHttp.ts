import { createHash } from "node:crypto";
import { readResponseTextUpTo } from "./readBody.js";
import { extractReadableText } from "./extractReadableText.js";

export type HttpFetchResult = {
  url: string;
  finalUrl: string;
  title?: string;
  contentText: string;
  truncated: boolean;
  contentHash: string;
  retrievedAt: string;
  contentType?: string;
};

export async function fetchUrlAsText(params: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  maxChars: number;
  userAgent: string;
}): Promise<HttpFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(params.url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": params.userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7"
      }
    });

    const finalUrl = res.url || params.url;
    const contentType = res.headers.get("content-type") ?? undefined;

    const { text: rawText, truncated } = await readResponseTextUpTo(res, params.maxBytes);

    let title: string | undefined;
    let text = rawText;

    const isHtml = contentType?.includes("text/html") || contentType?.includes("application/xhtml+xml");
    if (isHtml) {
      const extracted = extractReadableText({ html: rawText, url: finalUrl });
      title = extracted.title;
      text = extracted.text;
    }

    if (text.length > params.maxChars) {
      text = text.slice(0, params.maxChars);
    }

    const contentHash = createHash("sha256").update(text).digest("hex");

    return {
      url: params.url,
      finalUrl,
      title,
      contentText: text,
      truncated: truncated || rawText.length > params.maxChars,
      contentHash,
      retrievedAt: new Date().toISOString(),
      contentType
    };
  } finally {
    clearTimeout(timeout);
  }
}

