export type UserPlan = "free" | "essential" | "plus" | "pro" | "lifetime";

export interface PlanLimits {
  fileUpload: boolean;
  maxFileSize: number;          // bytes, 0 = disabled
  customDms: boolean;
  backupEmail: boolean;
  // Fixed DMS values for free tier (ignored if customDms is true)
  fixedDmsInitialDays: number;
  fixedDmsIntervalDays: number;
  fixedDmsMaxCount: number;
}

const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    fileUpload: false,
    maxFileSize: 0,
    customDms: false,
    backupEmail: false,
    fixedDmsInitialDays: 90,
    fixedDmsIntervalDays: 14,
    fixedDmsMaxCount: 3,
  },
  essential: {
    fileUpload: false,
    maxFileSize: 0,
    customDms: true,
    backupEmail: true,
    fixedDmsInitialDays: 90,
    fixedDmsIntervalDays: 14,
    fixedDmsMaxCount: 3,
  },
  plus: {
    fileUpload: true,
    maxFileSize: 2 * 1024 * 1024, // 2MB to stay within Vercel limits
    customDms: true,
    backupEmail: true,
    fixedDmsInitialDays: 90,
    fixedDmsIntervalDays: 14,
    fixedDmsMaxCount: 3,
  },
  pro: {
    fileUpload: true,
    maxFileSize: 3 * 1024 * 1024, // 3MB to stay within Vercel limits
    customDms: true,
    backupEmail: true,
    fixedDmsInitialDays: 90,
    fixedDmsIntervalDays: 14,
    fixedDmsMaxCount: 3,
  },
  lifetime: {
    fileUpload: true,
    maxFileSize: 3 * 1024 * 1024, // 3MB to stay within Vercel limits
    customDms: true,
    backupEmail: true,
    fixedDmsInitialDays: 90,
    fixedDmsIntervalDays: 14,
    fixedDmsMaxCount: 3,
  },
};

export function getPlanLimits(plan: UserPlan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

export const PAID_PLANS = ["essential", "plus", "pro", "lifetime"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function isPaidPlan(plan: string): plan is PaidPlan {
  return (PAID_PLANS as readonly string[]).includes(plan);
}

/** Map plan name → Stripe Price ID (from env). */
export function getStripePriceId(plan: PaidPlan): string | undefined {
  const map: Record<PaidPlan, string | undefined> = {
    essential: process.env.STRIPE_PRICE_ESSENTIAL,
    plus: process.env.STRIPE_PRICE_PLUS,
    pro: process.env.STRIPE_PRICE_PRO,
    lifetime: process.env.STRIPE_PRICE_LIFETIME,
  };
  return map[plan];
}

/** Map Stripe Price ID → plan name (reverse lookup). */
export function getPlanFromPriceId(priceId: string): PaidPlan | null {
  const entries: [PaidPlan, string | undefined][] = [
    ["essential", process.env.STRIPE_PRICE_ESSENTIAL],
    ["plus", process.env.STRIPE_PRICE_PLUS],
    ["pro", process.env.STRIPE_PRICE_PRO],
    ["lifetime", process.env.STRIPE_PRICE_LIFETIME],
  ];
  for (const [plan, id] of entries) {
    if (id && id === priceId) return plan;
  }
  return null;
}
