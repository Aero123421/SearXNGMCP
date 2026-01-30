import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Task = {
  category: string;
  tool: string;
  args: Record<string, unknown>;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function pickDomain(urlString: string): string | undefined {
  try {
    return new URL(urlString).hostname;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const mcpUrl = env("MCP_URL") ?? "http://127.0.0.1:8787/mcp";
  const apiKey = env("API_KEY") ?? env("API_KEYS");
  if (!apiKey) {
    console.error("Missing API_KEY (or API_KEYS). Example: API_KEY=... npm run eval");
    process.exit(2);
  }

  const filterCategory = env("CATEGORY");
  const tasksPath = env("TASKS") ?? "docs/eval/tasks.json";

  const raw = await readFile(tasksPath, "utf-8");
  const tasks = JSON.parse(raw) as Task[];
  const selected = filterCategory ? tasks.filter((t) => t.category === filterCategory) : tasks;

  const client = new Client({ name: "eval-client", version: "0.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${apiKey}` } }
  });
  await client.connect(transport);

  const out: any[] = [];
  for (const t of selected) {
    console.log(`\n[${t.category}] ${t.tool} ${JSON.stringify(t.args)}`);
    const result = await client.callTool({ name: t.tool, arguments: t.args });

    const structured = (result as any).structuredContent;
    out.push({ task: t, structured });

    if (t.tool.endsWith("web_image_search")) {
      const count = structured?.results?.length ?? 0;
      console.log(`images: ${count}`);
      continue;
    }
    if (t.tool.endsWith("web_research")) {
      const finalResults = structured?.finalResults ?? [];
      console.log(`queries: ${structured?.queries?.length ?? 0}, finalResults: ${finalResults.length}`);
      const topDomains = finalResults
        .map((r: any) => pickDomain(String(r.url)))
        .filter(Boolean)
        .slice(0, 5);
      console.log(`top domains: ${topDomains.join(", ")}`);
      continue;
    }
    if (t.tool.endsWith("web_search")) {
      const results = structured?.results ?? [];
      console.log(`results: ${results.length}, intent=${structured?.intent ?? ""}, lang=${structured?.language ?? ""}`);
      const topDomains = results
        .map((r: any) => pickDomain(String(r.url)))
        .filter(Boolean)
        .slice(0, 5);
      console.log(`top domains: ${topDomains.join(", ")}`);
    }
  }

  await transport.terminateSession().catch(() => undefined);
  await transport.close();

  const outPath = env("OUT") ?? "docs/eval/out.json";
  await (await import("node:fs/promises")).writeFile(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
