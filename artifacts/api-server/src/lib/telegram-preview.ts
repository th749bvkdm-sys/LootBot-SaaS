import { and, eq, sql } from 'drizzle-orm';
import { db, customersTable, productImagesTable, productsTable, telegramBotsTable } from '@workspace/db';
import { parseNavigationCallback, navigationFooter } from './telegram-navigation';
import { renderStoreScreen, rememberProductParent, type ScreenContext } from './telegram-store-screens';
import { presentTelegramScreen, themeDefaults, type ScreenStyleMap } from './telegram-presentation';
import { renderConfiguredHome, type HomeConfiguration } from './telegram-home-configuration';
import { commerceAvailability, renderCommerce } from './customer-commerce';
import { renderStoreHome } from './telegram-home-data';
import { productCardText } from './telegram-product-card';
import { productReviewSummary } from './customer-commerce';
import { productButtons, productInstructions } from './telegram-product-buttons';
import { featureGate } from './store-plans';

export async function previewStoreScreen(store: { id: string; name: string; currency: string }, configuration: HomeConfiguration, input: { callback?: string; customerId?: string; search?: string; state?: 'empty'|'error'|'success' }) {
  if(input.state!==undefined) {
    const messages = { empty:'معاينة تصميم الحالة الفارغة\nلا توجد عناصر لعرضها في هذه الحالة.', error:'معاينة تصميم حالة الخطأ\nتعذر إكمال الإجراء. أعد المحاولة.', success:'معاينة تصميم حالة النجاح\nاكتمل الإجراء. هذه معاينة للمظهر ولا تُنشئ طلبًا أو تغيّر بيانات.' };
    if(!Object.hasOwn(messages,input.state)) return null;
    return presentTelegramScreen(configuration.theme,configuration.screenStyles?.[input.state],messages[input.state],navigationFooter(),'معاينة '+store.name,'اسم العميل');
  }
  const action = parseNavigationCallback(input.callback ?? 'lb:home');
  if (!action || ['buy', 'contextual', 'screen', 'close', 'message'].includes(action.kind)) return null;
  const [customer] = input.customerId ? await db.select().from(customersTable).where(and(eq(customersTable.id, input.customerId), eq(customersTable.storeId, store.id))).limit(1) : [];
  if (input.customerId && !customer) return null;
  if (action.kind === 'home') return renderStoreHome(store, configuration, customer?.name ?? 'اسم العميل');
  let result: (ReturnType<typeof presentTelegramScreen> & { images?: string[] }) | null = null;
  const userId = customer ? Number(customer.telegramUserId) : 0;
  const context: ScreenContext = { storeId: store.id, storeName: store.name, currency: store.currency, chatId: 0, privateChat: !!customer, userId, customerName: customer?.name ?? 'اسم العميل', styles:configuration.screenStyles,
    send: async (text, buttons, screen = action.kind, media) => {
      const styled = presentTelegramScreen(configuration.theme, configuration.screenStyles?.[screen as keyof ScreenStyleMap], text, buttons, store.name, customer?.name ?? 'اسم العميل');
      result = {...styled,images:[...(media??[]),...(styled.imageUrl?[styled.imageUrl]:[])]};
      if(!result.imageUrl && media?.[0]) result.imageUrl=media[0];
    },
    product: async (code, parent, galleryIndex = 0) => {
      const [product] = await db.select().from(productsTable).where(and(eq(productsTable.storeId, store.id), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true), sql`substring(replace(${productsTable.id},'-','') from 1 for 12)=${code}`)).limit(1);
      if (!product) { await context.send('المنتج غير متاح.', navigationFooter(parent), 'error'); return; }
      const galleryEnabled = await featureGate.can(store.id, 'catalog.multipleImages');
      const stored = galleryEnabled ? await db.select().from(productImagesTable).where(eq(productImagesTable.productId, product.id)).orderBy(productImagesTable.sortOrder).limit(10) : [];
      const images = stored.length ? stored.map(i => i.imageUrl) : product.imageUrl ? [product.imageUrl] : [];
      const index = galleryIndex < images.length ? galleryIndex : 0; const ref = rememberProductParent(context, parent);
      const available = await commerceAvailability(store.id);
      const [bot] = await db.select({ username: telegramBotsTable.username }).from(telegramBotsTable).where(eq(telegramBotsTable.storeId, store.id)).limit(1);
      const productStyle = configuration.screenStyles?.product;
      const buttons = productButtons({ code, stock: product.stock, parent, parentRef: ref, galleryIndex: index, galleryCount: images.length, available, botUsername: bot?.username, productName: product.name, preview: true, galleryStyle:productStyle?.galleryStyle,buttonPlacement:productStyle?.buttonPlacement });
      const rating = available.reviews ? await productReviewSummary(store.id, product.id) : undefined;
      await context.send(productCardText(product,store.currency,configuration.productCardStyle??themeDefaults(configuration.theme).productCardStyle,rating,{index,total:images.length},productStyle?.badgeStyle) + productInstructions(code, bot?.username), buttons, 'product',images[index]?[images[index]]:[]);
    },
  };
  if (action.kind==='commerce') await renderCommerce(context,customer,action.feature,action.code,'preview',undefined,true,action.page??1,action.parentRef);
  else await renderStoreScreen(context, action, input.search?.slice(0, 120));
  return result;
}
