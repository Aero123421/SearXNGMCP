import { describe, expect, it } from "vitest";
import pino from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createWebSearchMcpServer } from "../src/mcp/server.js";
import { getAvailablePort, startStubSearxngServer } from "./helpers.js";

describe("mcp server", () => {
  it("requires auth and serves web_search", async () => {
    const searx = await startStubSearxngServer();
    const port = await getAvailablePort();

    const originalEnv = { ...process.env };
    process.env.HOST = "127.0.0.1";
    process.env.PORT = String(port);
    process.env.MCP_PATH = "/mcp";
    process.env.API_KEYS = "testkey";
    process.env.SEARXNG_BASE_URL = searx.baseUrl;
    process.env.RATE_LIMIT_PER_MINUTE = "999";
    process.env.RATE_LIMIT_PER_DAY = "9999";
    process.env.ENABLE_RENDERED_FETCH = "false";

    const logger = pino({ level: "silent", base: null });
    const server = await createWebSearchMcpServer({ logger });

    try {
      const url = new URL(server.url);

      // Bad token should fail
      {
        const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
        const transport = new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { authorization: "Bearer wrong" } }
        });
        await expect(client.connect(transport)).rejects.toBeTruthy();
        await transport.close().catch(() => undefined);
      }

      // Good token should work
      const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: "Bearer testkey" } }
      });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain("web_search");
      expect(toolNames).toContain("web_image_search");
      expect(toolNames).toContain("web_research");
      expect(toolNames).toContain("web_fetch");

      const result = await client.callTool({
        name: "web_search",
        arguments: { query: "fetch", limit: 5, mode: "fast", lang: "auto" }
      });

      const structured = (result as any).structuredContent as { results: any[] };
      expect(structured.results.length).toBeGreaterThanOrEqual(2);

      // Dedupe should remove utm variations and tech domain should be boosted
      const urls = structured.results.map((r) => r.url);
      expect(urls.filter((u) => String(u).includes("example.com")).length).toBe(1);
      expect(String(structured.results[0].url)).toContain("developer.mozilla.org");

      // lang=auto should be passed through (heuristic picks en for "fetch")
      const reqs = searx.getRequests();
      expect(reqs.some((r) => r.searchParams.language === "en")).toBe(true);

      // image search should return imageUrl
      const images = await client.callTool({
        name: "web_image_search",
        arguments: { query: "cat", limit: 5 }
      });
      const imgStructured = (images as any).structuredContent as { results: any[] };
      expect(imgStructured.results.length).toBeGreaterThanOrEqual(1);
      expect(String(imgStructured.results[0].imageUrl)).toContain("image");

      // research should aggregate across multiple queries (fetchTopK=0 avoids external fetch)
      const research = await client.callTool({
        name: "web_research",
        arguments: { question: "fetch api", maxQueries: 2, perQueryLimit: 3, fetchTopK: 0 }
      });
      const researchStructured = (research as any).structuredContent as {
        queries: any[];
        finalResults: any[];
        documents: any[];
      };
      expect(researchStructured.queries.length).toBe(2);
      expect(researchStructured.finalResults.length).toBeGreaterThanOrEqual(1);
      expect(researchStructured.documents.length).toBe(0);

      // web_fetch should block localhost by SSRF policy and return isError
      const fetchResult = await client.callTool({
        name: "web_fetch",
        arguments: { url: "http://127.0.0.1/" }
      });
      expect((fetchResult as any).isError).toBe(true);

      await transport.terminateSession().catch(() => undefined);
      await transport.close();
    } finally {
      process.env = originalEnv;
      await server.close();
      await searx.close();
    }
  });
});
