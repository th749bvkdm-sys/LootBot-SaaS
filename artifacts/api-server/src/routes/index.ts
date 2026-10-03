import { Router, type IRouter } from "express";
import authRouter from "./auth";
import catalogRouter from "./catalog";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import ordersRouter from "./orders";
import storesRouter from "./stores";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storesRouter);
router.use(catalogRouter);
router.use(telegramRouter);
router.use(ordersRouter);
router.use(dashboardRouter);

export default router;
