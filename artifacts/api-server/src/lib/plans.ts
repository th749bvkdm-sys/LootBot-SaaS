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
  | "catalog.bulkTools"
  | "catalog.multipleImages"
  | "analytics.advanced"
  | "coupons.basic"
  | "loyalty.basic"
  | "reviews.basic"
  | "referrals.basic"
  | "staff.basic"
  | "branding.removeLootBot";

type PlanDefinition = {
  name: string;
  limits: Record<PlanLimit, number>;
  features: Record<PlanFeature, boolean>;
};

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
      "catalog.bulkTools": false,
      "catalog.multipleImages": false,
      "analytics.advanced": false,
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
      "catalog.bulkTools": true,
      "catalog.multipleImages": false,
      "analytics.advanced": false,
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
      "catalog.bulkTools": true,
      "catalog.multipleImages": false,
      "analytics.advanced": false,
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
): boolean {
  return usage >= PLAN_CATALOG[plan].limits[limit];
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

export function isFeatureAvailable(plan: PlanCode, feature: PlanFeature): boolean {
  return PLAN_CATALOG[plan].features[feature];
}
