import pino, { type Logger } from "pino";

export function createLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: null
  });
}
