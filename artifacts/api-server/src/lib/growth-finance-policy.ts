import { ruleUses, type CustomerFacts, type Rule } from './customer-rules.ts';
import type { GrowthConfiguration } from './growth-configuration.ts';

function referencesFinancialSegment(rule: Rule | null, financialSegments: ReadonlySet<string>): boolean {
  if (!rule) return false;
  if ('op' in rule) return rule.rules.some(child => referencesFinancialSegment(child, financialSegments));
  return rule.field === 'CUSTOMER_SEGMENT' && (Array.isArray(rule.value) ? rule.value : [rule.value]).some(value => typeof value === 'string' && financialSegments.has(value));
}

export function ruleRequiresOwner(rule: Rule | null, financialSegments: ReadonlySet<string> = new Set()): boolean {
  return ruleUses(rule, 'TOTAL_SPEND_GREATER_THAN') || ruleUses(rule, 'ORDER_VALUE') || referencesFinancialSegment(rule, financialSegments);
}

/** A segment derived from a financial segment is itself financial, at any depth. */
export function financialSegmentClosure(rows: { id: string; configuration: GrowthConfiguration | null }[]): Set<string> {
  const financial = new Set(rows.filter(row => !row.configuration).map(row => row.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!financial.has(row.id) && row.configuration && growthRequiresOwner(row.configuration, financial)) {
      financial.add(row.id);
      changed = true;
    }
  }
  return financial;
}

/** Prevent both direct disclosure and repeated threshold queries that infer spend. */
export function growthRequiresOwner(configuration: GrowthConfiguration, financialSegments: ReadonlySet<string> = new Set()): boolean {
  const rules = [configuration.condition, ...configuration.actions.map(action => action.condition)];
  return configuration.audience?.type === 'highSpend'
    || (configuration.audience?.type === 'segment' && financialSegments.has(configuration.audience.segmentId))
    || rules.some(rule => ruleRequiresOwner(rule, financialSegments))
    || configuration.actions.some(action => ['ADD_SEGMENT', 'REMOVE_SEGMENT'].includes(action.type) && financialSegments.has(action.target));
}

export function publicCustomerFacts(facts: CustomerFacts, isOwner: boolean, financialSegments: ReadonlySet<string> = new Set()): Partial<CustomerFacts> {
  if (isOwner) return { ...facts };
  const { TOTAL_SPEND_GREATER_THAN: _spend, ORDER_VALUE: _value, ...visible } = facts;
  return { ...visible, CUSTOMER_SEGMENT: Array.isArray(visible.CUSTOMER_SEGMENT) ? visible.CUSTOMER_SEGMENT.filter(id => !financialSegments.has(id)) : [] };
}
