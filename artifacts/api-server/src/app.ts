import express, { type Express } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { authMiddleware } from "./middlewares/authMiddleware.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { apiCachePolicy } from "./middlewares/apiCachePolicy.js";
import { accountMutationGuard } from "./middlewares/accountMutationGuard.js";
import {
  BANK_STATEMENT_IMPORT_JSON_LIMIT,
  DEFAULT_API_JSON_LIMIT,
  DEFAULT_URLENCODED_LIMIT,
  FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
  FINANCIAL_SAVE_JSON_LIMIT,
  MONTHLY_REPORT_JSON_LIMIT,
  RESTORE_JSON_LIMIT,
} from "./lib/request-limits.js";

export {
  BANK_STATEMENT_IMPORT_JSON_LIMIT,
  DEFAULT_API_JSON_LIMIT,
  DEFAULT_URLENCODED_LIMIT,
  FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
  FINANCIAL_SAVE_JSON_LIMIT,
  MONTHLY_REPORT_JSON_LIMIT,
  RESTORE_JSON_LIMIT,
} from "./lib/request-limits.js";

const app: Express = express();
app.set("trust proxy", 1);

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
app.use("/api", apiCachePolicy);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use("/api/internal/storage-broker", express.json({ limit: 64 * 1024 }));
app.use(
  "/api/financial-data/restore",
  express.json({ limit: RESTORE_JSON_LIMIT }),
);
app.use(
  "/api/financial-data/monthly-reports",
  express.json({ limit: MONTHLY_REPORT_JSON_LIMIT }),
);
app.post(
  "/api/financial-data/bank-statement-import",
  express.json({ limit: BANK_STATEMENT_IMPORT_JSON_LIMIT }),
);
app.put(
  "/api/financial-data",
  express.json({ limit: FINANCIAL_SAVE_JSON_LIMIT }),
);
const defaultJsonParser = express.json({ limit: DEFAULT_API_JSON_LIMIT });
app.use((req, res, next) => {
  // A route-specific parser has already consumed and populated JSON bodies.
  if (req.body !== undefined) {
    next();
    return;
  }
  defaultJsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: DEFAULT_URLENCODED_LIMIT }));
app.use(authMiddleware);
app.use(accountMutationGuard);

app.use("/api", router);
app.use(errorHandler);

export default app;
