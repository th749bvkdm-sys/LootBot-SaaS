import { randomBytes } from 'node:crypto';
import { createSearchContexts, parseNavigationCallback, type BotButton } from './telegram-navigation.ts';

export function createBusinessNavigation(now: () => number = Date.now) {
  const contexts = createSearchContexts(now,512);
  return {
    wrap(storeId: string, userId: number, chatId: number, source: string, keyboard: BotButton[][], policy?: { revision: string; origin?: string }): BotButton[][] {
      return keyboard.map(row => row.map(button => {
        let callback = button.callback_data;
        if (!callback) return button;
        if (callback === 'lb:home' && button.text.includes('رجوع')) callback = `lb:screen:${source}`;
        const action = parseNavigationCallback(callback);
        if (!action || ['home', 'close', 'screen', 'contextual'].includes(action.kind)) return { ...button, callback_data: callback };
        const ref = randomBytes(6).toString('hex');
        // Each reference has its own scoped, expiring entry.
        const entryKey = `${storeId}:${ref}`;
        contexts.set(entryKey, userId, chatId, JSON.stringify({source,callback,...(policy?{revision:policy.revision,origin:policy.origin??callback}:{})}));
        return { ...button, callback_data: `lb:nav:${ref}` };
      }));
    },
    read(storeId: string, userId: number, chatId: number, ref: string) {
      const entry = contexts.get(`${storeId}:${ref}`, userId, chatId);
      if (!entry) return null;
      let parsed: {source:string;callback:string;revision?:string;origin?:string};
      try { parsed = JSON.parse(entry); } catch { return null; }
      const {source, callback} = parsed;
      if (!/^[a-z][a-z0-9_-]{0,23}$/.test(source) || !parseNavigationCallback(callback) || callback.startsWith('lb:nav:')) return null;
      return { source, callback, ...(parsed.revision?{revision:parsed.revision,origin:parsed.origin}:{}) };
    },
    rememberSearchOrigin(storeId: string, userId: number, chatId: number, source: string, policy?:{revision:string;origin?:string}) {
      contexts.set(`${storeId}:search-origin`, userId, chatId, JSON.stringify({source,...policy}));
    },
    searchOrigin(storeId: string, userId: number, chatId: number) {
      const entry=contexts.get(`${storeId}:search-origin`, userId, chatId);if(!entry)return null;try{return JSON.parse(entry).source as string;}catch{return null;}
    },
    searchPolicy(storeId:string,userId:number,chatId:number):{source:string;revision?:string;origin?:string}|null{
      const entry=contexts.get(`${storeId}:search-origin`,userId,chatId);if(!entry)return null;try{return JSON.parse(entry);}catch{return null;}
    },
    clearSearchOrigin(storeId: string, userId: number, chatId: number) {
      contexts.clear(`${storeId}:search-origin`, userId, chatId);
    },
  };
}
