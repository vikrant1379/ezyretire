import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import adviceRouter from "./advice.js";
import financeRouter from "./finance.js";
import { retryWhatsAppNotification } from "../lib/whatsapp.js";
import { createWhatsAppAdminRouter } from "./whatsapp.js";
import loginActivityRouter from "./login-activity.js";
import internalMaintenanceRouter from "./internal-maintenance.js";
import passkeyRouter from "./passkeys.js";
import premiumToolsRouter from "./premium-tools.js";
import storageBrokerRouter from "./storage-broker.js";
import accountComplianceRouter from "./account-compliance.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(passkeyRouter);
router.use(adviceRouter);
router.use(financeRouter);
router.use(createWhatsAppAdminRouter(retryWhatsAppNotification));
router.use(loginActivityRouter);
router.use(internalMaintenanceRouter);
router.use(storageBrokerRouter);
router.use(premiumToolsRouter);
router.use(accountComplianceRouter);

export default router;
