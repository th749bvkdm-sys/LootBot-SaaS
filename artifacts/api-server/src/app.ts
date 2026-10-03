import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import type { ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { recordSystemError } from "./lib/system-health";

const app: Express = express();
const publicDirectory = process.env.STATIC_DIR ?? path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../lootbot/dist/public",
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "لم يتم العثور على هذا المسار." });
});
app.use(express.static(publicDirectory, { index: false, maxAge: "1h" }));
app.get("/{*path}", (req, res, next) => {
  if (!req.accepts("html")) {
    next();
    return;
  }
  res.sendFile(path.join(publicDirectory, "index.html"), (error) => {
    if (error) next(error);
  });
});
const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  recordSystemError({
    occurredAt: new Date().toISOString(),
    method: req.method,
    path: req.path,
    errorType,
  });
  req.log.error({ errorType }, "Unhandled API request error.");
  if (!res.headersSent) {
    res.status(500).json({ error: "حدث خطأ غير متوقع." });
  }
};
app.use(apiErrorHandler);

export default app;
