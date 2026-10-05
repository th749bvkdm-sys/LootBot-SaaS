export const RULE_FIELDS = ['USER_LOGGED_IN', 'USER_NEW', 'HAS_ORDERS', 'HAS_ACTIVE_ORDER', 'VIP_LEVEL', 'POINTS_GREATER_THAN', 'ORDER_COUNT_GREATER_THAN', 'TOTAL_SPEND_GREATER_THAN', 'HAS_COUPON', 'HAS_REFERRAL', 'CUSTOMER_TAG', 'CUSTOMER_SEGMENT', 'DATE_RANGE', 'TIME_RANGE', 'CAMPAIGN', 'STORE_MODE', 'PLAN', 'ORDER_VALUE', 'PRODUCT', 'CATEGORY'] as const;
export type RuleField = typeof RULE_FIELDS[number];
export type Rule = { op: 'AND' | 'OR'; rules: Rule[] } | { field: RuleField; operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'NOT_IN'; value: string | number | boolean | (string | number)[] };
export type CustomerFacts = Record<RuleField, string | number | boolean | string[]>;
const numericFields = new Set<RuleField>(['VIP_LEVEL', 'POINTS_GREATER_THAN', 'ORDER_COUNT_GREATER_THAN', 'TOTAL_SPEND_GREATER_THAN', 'ORDER_VALUE']);
const boolFields = new Set<RuleField>(['USER_LOGGED_IN', 'USER_NEW', 'HAS_ORDERS', 'HAS_ACTIVE_ORDER', 'HAS_COUPON', 'HAS_REFERRAL']);
const listFields = new Set<RuleField>(['CUSTOMER_TAG', 'CUSTOMER_SEGMENT', 'PRODUCT', 'CATEGORY']);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseRule(value: unknown, depth = 0, budget = { remaining: 40 }): Rule | null {
  if (!record(value) || depth > 5 || --budget.remaining < 0) return null;
  if (value.op === 'AND' || value.op === 'OR') {
    if (!Array.isArray(value.rules) || !value.rules.length || value.rules.length > 20) return null;
    const rules = value.rules.map(v => parseRule(v, depth + 1, budget));
    return rules.every(Boolean) ? { op: value.op, rules: rules as Rule[] } : null;
  }
  const field = value.field as RuleField;
  const operator = value.operator as Exclude<Rule, { op: string }>['operator']; const target = value.value;
  if (!RULE_FIELDS.includes(field) || !['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT_IN'].includes(operator)) return null;
  if (field === 'DATE_RANGE' || field === 'TIME_RANGE') {
    if (!['IN', 'NOT_IN'].includes(operator) || !Array.isArray(target) || target.length !== 2 || !target.every(v => typeof v === 'string')) return null;
    if (field === 'DATE_RANGE') {
      if (!target.every(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v) || Date.parse(target[0]) >= Date.parse(target[1])) return null;
    } else if (!target.every(v => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))) return null;
  } else if (numericFields.has(field)) {
    if (typeof target !== 'number' || !Number.isFinite(target) || Math.abs(target) > 1e12 || ['IN', 'NOT_IN'].includes(operator)) return null;
  } else if (boolFields.has(field)) {
    if (typeof target !== 'boolean' || !['=', '!='].includes(operator)) return null;
  } else {
    if (!['=', '!=', 'IN', 'NOT_IN'].includes(operator)) return null;
    if (['IN', 'NOT_IN'].includes(operator)) {
      if (!Array.isArray(target) || !target.length || target.length > 20 || !target.every(v => typeof v === 'string' && v.length > 0 && v.length <= 100)) return null;
    } else if (typeof target !== 'string' || !target.length || target.length > 100) return null;
  }
  return { field, operator, value: target as Exclude<Rule, { op: string }>['value'] };
}
export function evaluateRule(rule: Rule | null, facts: Partial<CustomerFacts>): boolean {
  if (!rule) return true;
  if ('op' in rule) return rule.op === 'AND' ? rule.rules.every(r => evaluateRule(r, facts)) : rule.rules.some(r => evaluateRule(r, facts));
  const actual = facts[rule.field]; const expected = rule.value;
  if (actual === undefined || actual === null) return false;
  if (rule.field === 'DATE_RANGE' || rule.field === 'TIME_RANGE') {
    const [start, end] = expected as string[];
    const within = rule.field === 'DATE_RANGE' ? Number(actual) >= Date.parse(start) && Number(actual) < Date.parse(end)
      : start <= end ? String(actual) >= start && String(actual) < end : String(actual) >= start || String(actual) < end;
    return rule.operator === 'IN' ? within : !within;
  }
  const equal = listFields.has(rule.field) ? (actual as string[]).includes(String(expected)) : actual === expected;
  if (rule.operator === '=') return equal;
  if (rule.operator === '!=') return !equal;
  if (rule.operator === 'IN' || rule.operator === 'NOT_IN') {
    const values = expected as (string | number)[];
    const included = Array.isArray(actual) ? actual.some(v => values.includes(v)) : values.includes(actual as string | number);
    return rule.operator === 'IN' ? included : !included;
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  return rule.operator === '>' ? actual > expected : rule.operator === '>=' ? actual >= expected : rule.operator === '<' ? actual < expected : actual <= expected;
}
export function ruleUses(rule: Rule | null, field: RuleField): boolean {
  return !!rule && ('op' in rule ? rule.rules.some(r => ruleUses(r, field)) : rule.field === field);
}
