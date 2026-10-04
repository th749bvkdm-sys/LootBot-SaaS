export const PLAN_CODES = ["FREE", "PRO", "BUSINESS"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export type PlanLimit =
  | "stores"
  | "productsPerStore"
  | "categoriesPerStore"
  | "ordersPerMonth";
export type PlanFeature =
  | "catalog.basic"
  | "analytics.basic"
  | "telegram.basic"
  | "telegram.advanced"
  | "catalog.bulkTools"
  | "catalog.multipleImages"
  | "analytics.advanced"
  | "analytics.reports"
  | "coupons.basic"
  | "loyalty.basic"
  | "reviews.basic"
  | "referrals.basic"
  | "staff.basic"
  | "branding.removeLootBot";

export type FeatureMatrixEntry = {
  key: PlanFeature;
  requiredPlan: PlanCode;
  enabled: boolean;
  limit: number | null;
  usage: number | null;
  description: string;
};

export const FEATURE_METADATA: Record<PlanFeature, { requiredPlan: PlanCode; description: string }> = {
  "catalog.basic": { requiredPlan: "FREE", description: "إدارة المنتجات والتصنيفات الأساسية" },
  "analytics.basic": { requiredPlan: "FREE", description: "ملخص الطلبات والمبيعات الأساسي" },
  "telegram.basic": { requiredPlan: "FREE", description: "ربط بوت Telegram واستقبال الطلبات" },
  "telegram.advanced": { requiredPlan: "PRO", description: "رسائل ترحيب ومساعدة ومقدمة كتالوج مخصصة في بوت Telegram" },
  "catalog.bulkTools": { requiredPlan: "PRO", description: "نشر المنتجات أو تحويلها لمسودة جماعيًا" },
  "catalog.multipleImages": { requiredPlan: "PRO", description: "معرض صور متعدد لكل منتج" },
  "analytics.advanced": { requiredPlan: "BUSINESS", description: "تحليلات وتقارير متقدمة" },
  "analytics.reports": { requiredPlan: "BUSINESS", description: "تنزيل تقرير الطلبات بصيغة CSV" },
  "coupons.basic": { requiredPlan: "PRO", description: "إدارة كوبونات الخصم" },
  "loyalty.basic": { requiredPlan: "BUSINESS", description: "نقاط ولاء العملاء" },
  "reviews.basic": { requiredPlan: "PRO", description: "تقييمات ومراجعات العملاء" },
  "referrals.basic": { requiredPlan: "BUSINESS", description: "إحالات وتتبع العملاء" },
  "staff.basic": { requiredPlan: "BUSINESS", description: "إدارة أعضاء الفريق" },
  "branding.removeLootBot": { requiredPlan: "BUSINESS", description: "تحكم إضافي بعلامة المتجر (لا يزيل علامة Telegram)" },
};
export const CONFIGURABLE_FEATURES = new Set<PlanFeature>(["catalog.bulkTools", "analytics.reports", "telegram.advanced"]);

export type PlanDefinition = {
  name: string;
  limits: Record<PlanLimit, number>;
  features: Record<PlanFeature, boolean>;
};
export type PlanCatalog = Record<PlanCode, PlanDefinition>;

export const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
  FREE: {
    name: "Free",
    limits: {
      stores: 1,
      productsPerStore: 30,
      categoriesPerStore: 10,
      ordersPerMonth: 100,
    },
    features: {
      "catalog.basic": true,
      "analytics.basic": true,
      "telegram.basic": true,
      "telegram.advanced": false,
      "catalog.bulkTools": false,
      "catalog.multipleImages": false,
      "analytics.advanced": false,
      "analytics.reports": false,
      "coupons.basic": false,
      "loyalty.basic": false,
      "reviews.basic": false,
      "referrals.basic": false,
      "staff.basic": false,
      "branding.removeLootBot": false,
    },
  },
  PRO: {
    name: "Pro",
    limits: {
      stores: 5,
      productsPerStore: 500,
      categoriesPerStore: 100,
      ordersPerMonth: 5_000,
    },
    features: {
      "catalog.basic": true,
      "analytics.basic": true,
      "telegram.basic": true,
      "telegram.advanced": true,
      "catalog.bulkTools": true,
      "catalog.multipleImages": false,
      "analytics.advanced": false,
      "analytics.reports": false,
      "coupons.basic": false,
      "loyalty.basic": false,
      "reviews.basic": false,
      "referrals.basic": false,
      "staff.basic": false,
      "branding.removeLootBot": false,
    },
  },
  BUSINESS: {
    name: "Business",
    limits: {
      stores: 20,
      productsPerStore: 5_000,
      categoriesPerStore: 1_000,
      ordersPerMonth: 25_000,
    },
    features: {
      "catalog.basic": true,
      "analytics.basic": true,
      "telegram.basic": true,
      "telegram.advanced": true,
      "catalog.bulkTools": true,
      "catalog.multipleImages": false,
      "analytics.advanced": false,
      "analytics.reports": true,
      "coupons.basic": false,
      "loyalty.basic": false,
      "reviews.basic": false,
      "referrals.basic": false,
      "staff.basic": false,
      "branding.removeLootBot": false,
    },
  },
} as const;

const PLAN_RANK: Record<PlanCode, number> = {
  FREE: 0,
  PRO: 1,
  BUSINESS: 2,
};

export function highestPlan(plans: PlanCode[]): PlanCode {
  return plans.reduce(
    (highest, plan) => (PLAN_RANK[plan] > PLAN_RANK[highest] ? plan : highest),
    "FREE" as PlanCode,
  );
}

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && PLAN_CODES.includes(value as PlanCode);
}

export function readPlanCode(settings: unknown): PlanCode {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return "FREE";
  }
  const plan = (settings as Record<string, unknown>).plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return "FREE";
  const code = (plan as Record<string, unknown>).code;
  return isPlanCode(code) ? code : "FREE";
}

export function isPlanLimitReached(
  plan: PlanCode,
  limit: PlanLimit,
  usage: number,
  catalog: PlanCatalog = PLAN_CATALOG,
): boolean {
  return usage >= catalog[plan].limits[limit];
}

export function planLimitMessage(
  plan: PlanCode,
  limit: PlanLimit,
): string {
  const nextPlan = plan === "FREE" ? "Pro" : "Business";
  const descriptions: Record<PlanLimit, string> = {
    stores: "عدد المتاجر المسموح في باقتك",
    productsPerStore: "عدد المنتجات المسموح لهذا المتجر",
    categoriesPerStore: "عدد التصنيفات المسموح لهذا المتجر",
    ordersPerMonth: "عدد الطلبات الشهري المسموح لهذه الباقة",
  };
  return `${descriptions[limit]} اكتمل. الترقية إلى ${nextPlan} ستكون متاحة قريبًا.`;
}

export function isFeatureAvailable(plan: PlanCode, feature: PlanFeature, catalog: PlanCatalog = PLAN_CATALOG): boolean {
  return catalog[plan].features[feature];
}

export function validatePlanDefinition(value: unknown): value is PlanDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PlanDefinition>;
  if (typeof candidate.name !== "string" || candidate.name.length < 1 || candidate.name.length > 40) return false;
  if (!candidate.limits || !candidate.features) return false;
  const limitKeys = Object.keys(PLAN_CATALOG.FREE.limits) as PlanLimit[];
  const featureKeys = Object.keys(PLAN_CATALOG.FREE.features) as PlanFeature[];
  return limitKeys.every((key) => Number.isInteger(candidate.limits?.[key]) && candidate.limits![key] >= 1 && candidate.limits![key] <= 1_000_000)
    && featureKeys.every((key) => typeof candidate.features?.[key] === "boolean")
    && featureKeys.every((key) => CONFIGURABLE_FEATURES.has(key) || candidate.features?.[key] === PLAN_CATALOG.FREE.features[key])
    && Object.keys(candidate.limits).length === limitKeys.length
    && Object.keys(candidate.features).length === featureKeys.length;
}
