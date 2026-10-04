import { randomBytes } from 'node:crypto';
import { createSearchContexts, parseNavigationCallback, type BotButton } from './telegram-navigation.ts';

export function createBusinessNavigation(now: () => number = Date.now) {
  const contexts = createSearchContexts(now);
  return {
    wrap(storeId: string, userId: number, chatId: number, source: string, keyboard: BotButton[][]): BotButton[][] {
      return keyboard.map(row => row.map(button => {
        let callback = button.callback_data;
        if (callback === 'lb:home' && button.text.includes('رجوع')) callback = `lb:screen:${source}`;
        const action = parseNavigationCallback(callback);
        if (!action || ['home', 'close', 'screen', 'contextual'].includes(action.kind)) return { ...button, callback_data: callback };
        const ref = randomBytes(6).toString('hex');
        // Each reference has its own scoped, expiring entry.
        const entryKey = `${storeId}:${ref}`;
        contexts.set(entryKey, userId, chatId, `${source}|${callback}`);
        return { ...button, callback_data: `lb:nav:${ref}` };
      }));
    },
    read(storeId: string, userId: number, chatId: number, ref: string) {
      const entry = contexts.get(`${storeId}:${ref}`, userId, chatId);
      if (!entry) return null;
      const [source, callback] = entry.split('|');
      if (!/^[a-z][a-z0-9_-]{0,23}$/.test(source) || !parseNavigationCallback(callback) || callback.startsWith('lb:nav:')) return null;
      return { source, callback };
    },
    rememberSearchOrigin(storeId: string, userId: number, chatId: number, source: string) {
      contexts.set(`${storeId}:search-origin`, userId, chatId, source);
    },
    searchOrigin(storeId: string, userId: number, chatId: number) {
      return contexts.get(`${storeId}:search-origin`, userId, chatId);
    },
    clearSearchOrigin(storeId: string, userId: number, chatId: number) {
      contexts.clear(`${storeId}:search-origin`, userId, chatId);
    },
  };
}
