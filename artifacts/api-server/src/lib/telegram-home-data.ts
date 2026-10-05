import { and, asc, eq } from 'drizzle-orm';
import { db, productsTable } from '@workspace/db';
import { commerceAvailability, commerceHome } from './customer-commerce';
import { appendHomeCommerce, availableHomeConfiguration, renderConfiguredHome, type HomeConfiguration } from './telegram-home-configuration';
import type { BotButton } from './telegram-navigation';
export async function renderStoreHome(store:{id:string;name:string;currency:string},configuration:HomeConfiguration,customerName:string) {
  const availability = await commerceAvailability(store.id);
  const home=renderConfiguredHome(availableHomeConfiguration(configuration, availability),store.name,customerName);
  const extras = await commerceHome(store.id);
  if (availability.notifications) extras.push([{ text: '🔔 الإشعارات', callback_data: 'lb:commerce:notifications' }]);
  const keyboard:BotButton[][]=appendHomeCommerce(home.keyboard,configuration,extras as { text:string;callback_data:string }[][]);
  if(configuration.layout==='featured-first') {
    const featured=await db.select().from(productsTable).where(and(eq(productsTable.storeId,store.id),eq(productsTable.featured,true),eq(productsTable.isPublished,true),eq(productsTable.isDeleted,false))).orderBy(asc(productsTable.createdAt),asc(productsTable.id)).limit(3);
    keyboard.unshift(...featured.map(p=>[{text:`★ ${p.name.slice(0,35)} · ${p.price} ${store.currency}`,callback_data:`lb:product:${p.id.replaceAll('-','').slice(0,12)}`} ]));
  }
  return {...home,keyboard};
}
