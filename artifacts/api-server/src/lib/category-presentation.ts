export type CategoryPresentation = { imageUrl: string | null; emoji: string };
export function parseCategoryPresentation(input: unknown): CategoryPresentation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { imageUrl, emoji } = input as Record<string, unknown>;
  if (typeof emoji !== 'string') return null;
  const cleanEmoji = emoji.trim();
  if (!cleanEmoji || [...cleanEmoji].length > 8 || !/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f]+$/u.test(cleanEmoji)) return null;
  if (imageUrl !== null && typeof imageUrl !== 'string') return null;
  const cleanUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (cleanUrl) {
    if (cleanUrl.length > 1500 || /[\u0000-\u0020\u007f]/.test(cleanUrl)) return null;
    try { const url = new URL(cleanUrl); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null; } catch { return null; }
  }
  return { imageUrl: cleanUrl || null, emoji: cleanEmoji };
}
