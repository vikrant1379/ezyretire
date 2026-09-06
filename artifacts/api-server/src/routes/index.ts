import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import adviceRouter from "./advice.js";
import financeRouter from "./finance.js";
import { retryWhatsAppNotification } from "../lib/whatsapp.js";
import { createWhatsAppAdminRouter } from "./whatsapp.js";
import loginActivityRouter from "./login-activity.js";
import internalMaintenanceRouter from "./internal-maintenance.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adviceRouter);
router.use(financeRouter);
router.use(createWhatsAppAdminRouter(retryWhatsAppNotification));
router.use(loginActivityRouter);
router.use(internalMaintenanceRouter);

export default router;
