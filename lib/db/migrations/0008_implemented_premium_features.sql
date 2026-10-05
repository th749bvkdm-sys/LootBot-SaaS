-- Runs once through run-migrations.mjs. Only the complete legacy feature
-- defaults are upgraded; saved names, limits and customized features survive.
WITH legacy AS (
  SELECT 'PRO'::text AS code, '{"catalog.basic":true,"analytics.basic":true,"telegram.basic":true,"telegram.advanced":true,"catalog.bulkTools":true,"catalog.multipleImages":true,"analytics.advanced":false,"analytics.reports":false,"coupons.basic":false,"loyalty.basic":false,"reviews.basic":false,"referrals.basic":false,"staff.basic":false,"branding.removeLootBot":false}'::jsonb AS features,
    '{"coupons.basic":true,"loyalty.basic":true,"reviews.basic":true,"referrals.basic":true}'::jsonb AS implemented, false AS studio
  UNION ALL
  SELECT 'BUSINESS', '{"catalog.basic":true,"analytics.basic":true,"telegram.basic":true,"telegram.advanced":true,"catalog.bulkTools":true,"catalog.multipleImages":true,"analytics.advanced":false,"analytics.reports":true,"coupons.basic":false,"loyalty.basic":false,"reviews.basic":false,"referrals.basic":false,"staff.basic":false,"branding.removeLootBot":false}'::jsonb,
    '{"coupons.basic":true,"loyalty.basic":true,"reviews.basic":true,"referrals.basic":true,"staff.basic":true,"analytics.advanced":true,"branding.removeLootBot":true}'::jsonb, true
)
UPDATE plan_definitions AS plan
SET definition = jsonb_set(plan.definition, '{features}', jsonb_build_object('telegram.studio', legacy.studio) || (plan.definition->'features') || legacy.implemented), updated_at = now()
FROM legacy
WHERE plan.code = legacy.code
  AND (plan.definition->'features') - 'telegram.studio' = legacy.features;
