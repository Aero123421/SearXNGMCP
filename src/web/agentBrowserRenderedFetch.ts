import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export type RenderedFetchResult = {
  url: string;
  finalUrl: string;
  title?: string;
  contentText: string;
  truncated: boolean;
  contentHash: string;
  retrievedAt: string;
};

type JsonEnvelope = {
  ok?: boolean;
  data?: any;
  error?: any;
};

function unwrapData(envelope: JsonEnvelope): any {
  if (!envelope || typeof envelope !== "object") return undefined;
  if ("data" in envelope) return (envelope as any).data;
  return undefined;
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const s = value.trim();
    return s ? s : undefined;
  }
  return undefined;
}

function runAgentBrowserJson(params: {
  bin: string;
  args: string[];
  timeoutMs: number;
}): Promise<JsonEnvelope> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.bin, [...params.args, "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`agent-browser timeout: ${params.args.join(" ")}`));
    }, params.timeoutMs);

    child.stdout.on("data", (d) => stdout.push(Buffer.from(d)));
    child.stderr.on("data", (d) => stderr.push(Buffer.from(d)));

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString("utf-8");
        reject(new Error(`agent-browser failed (code=${code}): ${errText}`));
        return;
      }
      const outText = Buffer.concat(stdout).toString("utf-8").trim();
      try {
        resolve(JSON.parse(outText) as JsonEnvelope);
      } catch (e) {
        reject(new Error(`agent-browser invalid json: ${outText.slice(0, 2000)}`));
      }
    });
  });
}

async function runAgentBrowserText(params: {
  bin: string;
  args: string[];
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.bin, params.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`agent-browser timeout: ${params.args.join(" ")}`));
    }, params.timeoutMs);

    child.stdout.on("data", (d) => stdout.push(Buffer.from(d)));
    child.stderr.on("data", (d) => stderr.push(Buffer.from(d)));

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString("utf-8");
        reject(new Error(`agent-browser failed (code=${code}): ${errText}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf-8"));
    });
  });
}

export async function renderedFetchWithAgentBrowser(params: {
  bin: string;
  url: string;
  timeoutMs: number;
  maxChars: number;
}): Promise<RenderedFetchResult> {
  const session = `mcp-${randomUUID()}`;
  try {
    // Stabilize + speed up: reduce heavy assets (images/fonts/media).
    await runAgentBrowserText({
      bin: params.bin,
      timeoutMs: Math.min(5_000, params.timeoutMs),
      args: ["--session", session, "set", "viewport", "1280", "720"]
    }).catch(() => undefined);

    const abortPatterns = [
      "**/*.png",
      "**/*.jpg",
      "**/*.jpeg",
      "**/*.gif",
      "**/*.webp",
      "**/*.avif",
      "**/*.svg",
      "**/*.woff",
      "**/*.woff2",
      "**/*.ttf",
      "**/*.otf",
      "**/*.mp4",
      "**/*.webm",
      "**/*.mp3"
    ];
    for (const pattern of abortPatterns) {
      // Best-effort; if unsupported by provider, just ignore.
      await runAgentBrowserText({
        bin: params.bin,
        timeoutMs: Math.min(5_000, params.timeoutMs),
        args: ["--session", session, "network", "route", pattern, "--abort"]
      }).catch(() => undefined);
    }

    await runAgentBrowserText({
      bin: params.bin,
      timeoutMs: params.timeoutMs,
      args: ["--session", session, "open", params.url]
    });

    await runAgentBrowserText({
      bin: params.bin,
      timeoutMs: params.timeoutMs,
      args: ["--session", session, "wait", "--load", "networkidle"]
    });

    const urlResp = await runAgentBrowserJson({
      bin: params.bin,
      timeoutMs: params.timeoutMs,
      args: ["--session", session, "get", "url"]
    });
    const urlData = unwrapData(urlResp);
    const finalUrl =
      coerceString(urlData?.url) ??
      coerceString(urlData?.value) ??
      coerceString(urlData) ??
      params.url;

    const titleResp = await runAgentBrowserJson({
      bin: params.bin,
      timeoutMs: params.timeoutMs,
      args: ["--session", session, "get", "title"]
    });
    const titleData = unwrapData(titleResp);
    const title =
      coerceString(titleData?.title) ?? coerceString(titleData?.value) ?? coerceString(titleData);

    const textResp = await runAgentBrowserJson({
      bin: params.bin,
      timeoutMs: params.timeoutMs,
      args: [
        "--session",
        session,
        "eval",
        "document.documentElement ? document.documentElement.innerText : document.body.innerText"
      ]
    });
    const textData = unwrapData(textResp);
    const rawText = String(textData?.result ?? textData?.value ?? textData ?? "");

    const truncated = rawText.length > params.maxChars;
    const contentText = truncated ? rawText.slice(0, params.maxChars) : rawText;
    const contentHash = createHash("sha256").update(contentText).digest("hex");

    return {
      url: params.url,
      finalUrl,
      title,
      contentText,
      truncated,
      contentHash,
      retrievedAt: new Date().toISOString()
    };
  } finally {
    await runAgentBrowserText({
      bin: params.bin,
      timeoutMs: Math.min(5_000, params.timeoutMs),
      args: ["--session", session, "close"]
    }).catch(() => undefined);
  }
}
