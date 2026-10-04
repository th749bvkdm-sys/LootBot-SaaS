import { Router, type IRouter } from "express";
import { requireAuth, getOwnedStore } from "../lib/auth-middleware";
import { getPlanCatalog, getPlanUsage, getStorePlan } from "../lib/store-plans";

const router: IRouter = Router();

router.get("/stores/:storeId/plan", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !storeId) {
    res.status(400).json({ error: "معرّف المتجر غير صالح." });
    return;
  }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) {
    res.status(404).json({ error: "لم يتم العثور على المتجر." });
    return;
  }

  const plan = await getStorePlan(store.id);
  const catalog = await getPlanCatalog();
  res.json({
    plan,
    planName: catalog[plan].name,
    billing: "manual_admin_assignment",
    limits: catalog[plan].limits,
    features: catalog[plan].features,
    usage: await getPlanUsage(store.id, req.auth!.userId),
  });
});

export default router;
