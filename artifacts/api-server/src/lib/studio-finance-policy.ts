import type { BusinessConfiguration } from './telegram-business-configuration.ts';
import { ruleRequiresOwner } from './growth-finance-policy.ts';

export function businessRequiresOwner(configuration: BusinessConfiguration, financialSegments: ReadonlySet<string> = new Set()): boolean {
  return configuration.screens.some(screen => ruleRequiresOwner(screen.condition ?? null, financialSegments)
    || [...screen.blocks, ...screen.buttons].some(item => ruleRequiresOwner(item.condition ?? null, financialSegments)));
}
