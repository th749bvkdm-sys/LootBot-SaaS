import { Router, type IRouter } from "express";
import { getStoreAccess } from '../lib/staff-access';
import { requireAuth, getOwnedStore } from "../lib/auth-middleware";
import { getPlanCatalog, getPlanUsage, getStorePlan } from "../lib/store-plans";

const router: IRouter = Router();

router.get("/stores/:storeId/plan", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !storeId) {
    res.status(400).json({ error: "معرّف المتجر غير صالح." });
    return;
  }
  const store = await getStoreAccess(storeId, req.auth!.userId, 'member');
  if (!store) {
    res.status(404).json({ error: "لم يتم العثور على المتجر." });
    return;
  }

  const plan = await getStorePlan(store.id);
  const catalog = await getPlanCatalog();
  const usage = await getPlanUsage(store.id, store.ownerId);
  const remaining = Object.fromEntries(Object.entries(catalog[plan].limits).map(([key, maximum]) => [key, Math.max(0, maximum - usage[key as keyof typeof usage])]));
  const warnings = Object.fromEntries(Object.entries(catalog[plan].limits).map(([key, maximum]) => [key, usage[key as keyof typeof usage] >= maximum ? "reached" : usage[key as keyof typeof usage] / maximum >= 0.8 ? "near" : "normal"]));
  res.json({
    plan,
    planName: catalog[plan].name,
    billing: "manual_admin_assignment",
    limits: catalog[plan].limits,
    features: catalog[plan].features,
    usage,
    remaining,
    warnings,
  });
});

export default router;
