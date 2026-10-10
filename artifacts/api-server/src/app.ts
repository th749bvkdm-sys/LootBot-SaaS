import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import type { ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { recordSystemError } from "./lib/system-health";
import { FeatureAccessError } from "./lib/plans";

const app: Express = express();
// Render terminates TLS at one trusted proxy hop; using req.ip keeps IP-based
// login throttling scoped to the real client instead of every visitor sharing the proxy IP.
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
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
// Exam scans remain private and never pass through the general JSON parser.
app.use('/api/teacher/assets', express.raw({ type: ['image/jpeg','image/png','image/webp'], limit: '8mb' }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "لم يتم العثور على هذا المسار." });
});
app.use(express.static(publicDirectory, { index: false, maxAge: "1h" }));
app.get("/{*path}", (req, res, next) => {
  // All non-API GET routes are SPA entry points. Some browser bridges send
  // malformed Accept tokens; content negotiation must not break navigation.
  res.sendFile(path.join(publicDirectory, "index.html"), (error) => {
    if (error) next(error);
  });
});
const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error?.type === 'entity.too.large' && !res.headersSent) { res.status(413).json({ error: 'حجم الملف أو المستند أكبر من الحد المسموح.' }); return; }
  if (error?.type === 'entity.parse.failed' && !res.headersSent) { res.status(400).json({ error: 'تنسيق الطلب غير صالح.' }); return; }
  if (error instanceof FeatureAccessError && !res.headersSent) {
    res.status(error.status).json({ code: error.code, feature: error.feature, requiredPlan: error.requiredPlan, error: error.message });
    return;
  }
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
