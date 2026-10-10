export const STOREFRONT_THEMES = ['dark', 'white', 'nebula'] as const;
export type StorefrontTheme = typeof STOREFRONT_THEMES[number];
export function readStorefrontSettings(settings: Record<string, unknown> | null | undefined): { theme: StorefrontTheme; enabled: boolean } {
  const raw = settings?.storefront;
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { theme: STOREFRONT_THEMES.includes(value.theme as StorefrontTheme) ? value.theme as StorefrontTheme : 'dark', enabled: value.enabled === true };
}
export function mergeStorefrontSettings(settings: Record<string, unknown>, appearance: { theme: StorefrontTheme; enabled: boolean }) {
  const previous = settings.storefront && typeof settings.storefront === 'object' ? settings.storefront as Record<string, unknown> : {};
  return { ...settings, storefront: { ...previous, ...appearance } };
}
export function safeStorefrontImage(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? url : null; } catch { return null; }
}
