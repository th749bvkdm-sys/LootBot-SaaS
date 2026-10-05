import { Router, type IRouter } from "express";
import authRouter from "./auth";
import adminRouter from "./admin";
import catalogRouter from "./catalog";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import ordersRouter from "./orders";
import plansRouter from "./plans";
import reportsRouter from "./reports";
import storesRouter from "./stores";
import telegramRouter from "./telegram";
import { growthRouter } from './growth';
import { commerceRouter } from './commerce';
import teamRouter from './team';
import analyticsRouter from './analytics';

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(storesRouter);
router.use(catalogRouter);
router.use(telegramRouter);
router.use(growthRouter);
router.use(commerceRouter);
router.use(teamRouter);
router.use(analyticsRouter);
router.use(ordersRouter);
router.use(plansRouter);
router.use(reportsRouter);
router.use(dashboardRouter);

export default router;
