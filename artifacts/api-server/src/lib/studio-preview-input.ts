import { parseNavigationCallback } from './telegram-navigation.ts';
import type { BusinessConfiguration } from './telegram-business-configuration.ts';

export type StudioPreviewInput = {
  callbackData?: string;
  customerId?: string;
  search?: string;
  state?: 'empty' | 'error' | 'success';
  screenId?: string;
  returning?: boolean;
};

/** Validate before database lookup or preview rendering; empty customer means guest. */
export function parseStudioPreviewInput(value: unknown, business?: BusinessConfiguration): StudioPreviewInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.callbackData !== undefined && !parseNavigationCallback(raw.callbackData)) return null;
  if (raw.customerId !== undefined && (typeof raw.customerId !== 'string' || (raw.customerId !== '' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.customerId)))) return null;
  if (raw.search !== undefined && (typeof raw.search !== 'string' || raw.search.length > 120)) return null;
  if (raw.state !== undefined && !['empty', 'error', 'success'].includes(raw.state as string)) return null;
  if (business) {
    if (typeof raw.screenId !== 'string' || !business.screens.some(screen => screen.id === raw.screenId) || typeof raw.returning !== 'boolean') return null;
    const action = parseNavigationCallback(raw.callbackData);
    if (action?.kind === 'screen' && (!business.screens.some(screen => screen.id === action.id) || action.id !== raw.screenId)) return null;
    if (action?.kind === 'home' && raw.screenId !== 'home') return null;
  }
  return {
    ...(raw.callbackData !== undefined ? { callbackData: raw.callbackData as string } : {}),
    ...(raw.customerId ? { customerId: raw.customerId as string } : {}),
    ...(raw.search !== undefined ? { search: raw.search as string } : {}),
    ...(raw.state !== undefined ? { state: raw.state as StudioPreviewInput['state'] } : {}),
    ...(business ? { screenId: raw.screenId as string, returning: raw.returning as boolean } : {}),
  };
}
