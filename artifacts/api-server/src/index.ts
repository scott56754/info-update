import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Keep-alive: ping own health endpoint every 4 minutes so Replit doesn't spin down the process
  const keepAliveUrl = `http://localhost:${port}/api/healthz`;
  setInterval(async () => {
    try {
      const res = await fetch(keepAliveUrl);
      if (!res.ok) logger.warn({ status: res.status }, "Keep-alive ping returned non-OK");
    } catch {
      // Silently ignore — transient failures are expected during restarts
    }
  }, 4 * 60 * 1000);
});

startBot().catch((err) => logger.error({ err }, "Bot failed to start"));
