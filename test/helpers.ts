import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

export async function startStubSearxngServer(): Promise<{
  baseUrl: string;
  getRequests: () => Array<{ path: string; searchParams: Record<string, string> }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ path: string; searchParams: Record<string, string> }> = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({
      path: url.pathname,
      searchParams: Object.fromEntries(url.searchParams.entries())
    });
    if (url.pathname !== "/search") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const q = url.searchParams.get("q") ?? "";
    const categories = (url.searchParams.get("categories") ?? "").toLowerCase();
    const results = [
      ...(categories.includes("images")
        ? [
            {
              title: "Example Image",
              url: "https://example.com/page",
              img_src: "https://example.com/image.jpg",
              thumbnail_src: "https://example.com/thumb.jpg",
              engine: "stub",
              score: 5
            }
          ]
        : [
            {
              title: "MDN fetch",
              url: "https://developer.mozilla.org/en-US/docs/Web/API/fetch",
              content: "fetch() はネットワークリクエストのためのAPIです",
              engine: "stub",
              score: 1
            }
          ]),
      {
        title: `Generic result for ${q}`,
        url: `https://example.com/search?q=${encodeURIComponent(q)}&utm_source=dup`,
        content: "generic content",
        engine: "stub",
        score: 10
      },
      {
        title: `Generic result for ${q} (dup)`,
        url: `https://example.com/search?q=${encodeURIComponent(q)}&utm_source=dup2`,
        content: "generic content 2",
        engine: "stub",
        score: 9
      }
    ];

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ results }));
  });

  const port = await getAvailablePort();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    getRequests: () => [...requests],
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}
