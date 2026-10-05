import app from "./app";
import { logger } from "./lib/logger";
import { startGrowthWorker, stopGrowthWorker } from "./lib/growth-service";
import {
  startActiveStoreBots,
  stopAllBots,
} from "./lib/telegram-bot-manager";

const port = Number(process.env["PORT"] ?? 5000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"] ?? "5000"}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

void startActiveStoreBots().catch((error: unknown) => {
  logger.error(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "Could not resume stored Telegram bots.",
  );
});
startGrowthWorker();

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down LootBot API.");
  stopAllBots({ shutdown: true });
  stopGrowthWorker();
  server.close((error) => {
    if (error) {
      logger.error(
        { errorType: error.name },
        "API server did not close cleanly.",
      );
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
