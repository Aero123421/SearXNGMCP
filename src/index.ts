import { createWebSearchMcpServer } from "./mcp/server.js";
import { createLogger } from "./observability/logger.js";

const logger = createLogger();

async function main(): Promise<void> {
  const { close, url } = await createWebSearchMcpServer({ logger });
  logger.info({ url }, "mcp server listening");

  const shutdown = async () => {
    logger.info("shutdown requested");
    await close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error({ error }, "fatal");
  process.exit(1);
});

