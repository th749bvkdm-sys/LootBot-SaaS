import { cloneElement, type FormEvent, type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, Boxes, Check, CircleDollarSign,
  ChevronDown, CircleHelp, Command, Eye, EyeOff, LayoutDashboard,
  LogOut, Menu, MessageCircle, Package, Plus, Search, Settings2, ShieldCheck,
  ShoppingBag, Store as StoreIcon, Tag, Trash2, Users, X, Zap,
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetCsrfTokenQueryKey, getGetDashboardActivityQueryKey, getGetDashboardSummaryQueryKey,
  getListOrdersQueryKey,
  getGetStoreBotQueryKey, getListCategoriesQueryKey, getListProductsQueryKey, getListStoresQueryKey,
  useConnectStoreBot, useCreateCategory, useCreateProduct, useCreateStore, useDeleteCategory,
  useDeleteProduct, useDeleteStore, useDisconnectStoreBot, useGetCsrfToken, useGetCurrentUser,
  useGetDashboardActivity, useGetDashboardSummary, useGetStoreBot, useListCategories,
  useListOrders, useListProducts, useListStores, useLoginUser, useLogoutUser, useRegisterUser,
  useUpdateCategory, useUpdateProduct, useUpdateStore,
  useUpdateOrderStatus,
  useUpdateOrderPayment,
} from '@workspace/api-client-react';
import type { Order, ProductInput, Store } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { ProductGallery } from '@/components/product-gallery';
import { TelegramHomeStudio } from '@/components/telegram-home-studio';
import { TelegramHealth } from '@/components/telegram-health';
import { BusinessBotStudio } from '@/components/business-bot-studio';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
type Locale = 'ar' | 'en';
const copy = {
  ar: {
    overview: 'نظرة عامة', stores: 'متاجري', products: 'المنتجات', categories: 'التصنيفات', orders: 'الطلبات',
    telegram: 'Telegram', settings: 'الإعدادات', hello: 'مساء الخير', dashboard: 'لوحة المتجر',
    tagline: 'متجرك، من مكان واحد.', welcome: 'أهلاً', productsTotal: 'كل المنتجات',
    published: 'منشور في المتجر', categoriesTotal: 'التصنيفات', sales: 'الطلبات',
    revenue: 'الإيرادات', activity: 'آخر النشاطات', quick: 'اختصارات سريعة',
    addProduct: 'أضف منتجاً', connect: 'اربط بوت Telegram', manage: 'إدارة المنتجات',
    createStore: 'أنشئ متجرك الأول', empty: 'لا توجد بيانات بعد', retry: 'حاول مجدداً',
    search: 'ابحث عن منتج...', new: 'إضافة جديد', name: 'الاسم', description: 'الوصف',
    price: 'السعر', stock: 'المخزون', category: 'التصنيف', sku: 'رمز المنتج',
    actions: 'إجراءات', save: 'حفظ التغييرات', cancel: 'إلغاء', edit: 'تعديل',
    delete: 'حذف', publishedFlag: 'منشور', draft: 'مسودة', next: 'التالي', previous: 'السابق',
    storeName: 'اسم المتجر', currency: 'العملة', botToken: 'رمز البوت من BotFather',
    connectBot: 'ربط البوت', disconnect: 'قطع الاتصال', connected: 'متصل',
    disconnected: 'غير متصل', botHelp: 'أدخل رمز البوت لنشر كتالوج منتجاتك عبر Telegram.',
    settingsTitle: 'إعدادات المتجر', settingsSub: 'اسم متجرك وعملته الأساسية.',
    signOut: 'تسجيل الخروج', account: 'الحساب', email: 'البريد الإلكتروني',
    password: 'كلمة المرور', fullName: 'الاسم الكامل', login: 'تسجيل الدخول',
    register: 'إنشاء حساب', haveAccount: 'لديك حساب؟', noAccount: 'ليس لديك حساب؟',
    start: 'ابدأ الآن', enter: 'ادخل إلى لوحة متجرك', createAccount: 'أنشئ حسابك وجهّز متجرك',
    onboarding: 'لنجهز متجرك', onboardingSub: 'أضف متجرك ومنتجاتك، واربط البوت الآن أو لاحقًا.',
    firstProduct: 'منتجك الأول', createFirstProduct: 'إضافة المنتج الأول',
    continue: 'متابعة', skip: 'تخطي الآن', connectLater: 'يمكنك ربط البوت لاحقاً من لوحة التحكم.',
    store: 'المتجر', noStores: 'لم تنشئ متجراً بعد', storesSub: 'كل متاجرك في مكان واحد.',
    create: 'إنشاء متجر', confirmDelete: 'هل تريد حذف هذا العنصر؟', currencyHint: 'اختر العملة التي تعرض بها أسعارك.',
    noActivity: 'ستظهر هنا آخر التغييرات على متجرك.', serverError: 'تعذر تحميل البيانات.',
    arabic: 'العربية', english: 'English', online: 'متصل الآن', workspace: 'مساحة العمل',
    signInCta: 'دخول', featureOne: 'كتالوجك على Telegram', featureTwo: 'إدارة سهلة للمخزون',
    featureThree: 'استعراض المنتجات عبر البوت', heroSub: 'أضف منتجاتك واربط بوت Telegram ليتمكن عملاؤك من استعراض الكتالوج. إدارة واضحة وآمنة، بلا تعقيد.',
    heroEyebrow: 'أدوات بيع صُممت للتجار', trust: 'كل ما يحتاجه متجرك الرقمي، دون ضجيج.',
    walkthrough: 'من أول منتج إلى كتالوج جاهز', walkthroughSub: 'أدوات واضحة تساعدك على إدارة يومك بثقة.',
    step1: 'أضف منتجاتك', step2: 'اربط بوتك', step3: 'شارك الكتالوج',
    ctaEnd: 'متجرك يبدأ بخطوة.', footer: 'صُنع لأصحاب المتاجر الذين ينجزون.',
    faqTitle: 'أسئلة شائعة', faq1q: 'كيف أربط بوت Telegram؟',
    faq1a: 'أنشئ بوتًا عبر BotFather، ثم ألصق رمزه في صفحة Telegram داخل لوحة المتجر. يُخزّن الرمز مشفّرًا.',
    faq2q: 'هل يدعم LootBot اللغة العربية؟',
    faq2a: 'نعم. الواجهة تدعم العربية واتجاه RTL، ويمكنك التبديل إلى الإنجليزية.',
    faq3q: 'هل أحتاج إلى خدمة مدفوعة للبدء؟',
    faq3a: 'لا تحتاج إلى مزوّد دفع أو منصة متجر خارجية لإضافة المنتجات وربط البوت.',
    faq4q: 'ما الذي يستطيع العملاء فعله مع البوت الآن؟',
    faq4a: 'يمكنهم استعراض المنتجات وتسجيل طلب عبر البوت. يدير المتجر حالة الطلب، ويرسل البوت تحديثاتها عند توفر الاتصال؛ الدفع داخل البوت غير متاح بعد.',
    orderPending: 'قيد الانتظار', orderConfirmed: 'مؤكد', orderFulfilled: 'مكتمل', orderCancelled: 'ملغي',
    allOrders: 'كل الحالات', orderCustomer: 'العميل', orderItems: 'المنتجات', orderTotal: 'الإجمالي',
    confirmOrder: 'تأكيد الطلب', fulfillOrder: 'تم التجهيز', cancelOrder: 'إلغاء الطلب',
    cancelOrderConfirm: 'سيتم إلغاء الطلب وإعادة الكمية إلى المخزون. هل تريد المتابعة؟',
    noOrders: 'لا توجد طلبات بعد.', orderFlowNote: 'يتم الدفع خارج LootBot. سجّل استلام المبلغ أو إعادته يدويًا؛ يلزم تسجيل الاسترداد قبل إلغاء طلب مدفوع.',
    paidRevenue: 'مبالغ مدفوعة مسجلة', manualPaymentInstructions: 'تعليمات الدفع اليدوي',
    manualPaymentInstructionsHint: 'ستُرسل هذه التعليمات للعميل بعد تسجيل الطلب. الدفع يتم خارج LootBot.',
    paymentUnpaid: 'غير مدفوع', paymentPaid: 'مدفوع يدويًا', paymentRefunded: 'مسترد يدويًا',
    markPaid: 'تسجيل استلام الدفع', markRefunded: 'تسجيل إعادة المبلغ',
    markPaidConfirm: 'هل استلمت المبلغ خارج LootBot؟',
    markRefundedConfirm: 'هل أعدت المبلغ للعميل خارج LootBot؟',
    paymentUpdatedAt: 'تحديث الدفع',
  },
  en: {
    overview: 'Overview', stores: 'My stores', products: 'Products', categories: 'Categories', orders: 'Orders',
    telegram: 'Telegram', settings: 'Settings', hello: 'Good evening', dashboard: 'Store dashboard',
    tagline: 'Your store, in one place.', welcome: 'Welcome', productsTotal: 'All products',
    published: 'Published products', categoriesTotal: 'Categories', sales: 'Orders',
    revenue: 'Revenue', activity: 'Recent activity', quick: 'Quick actions',
    addProduct: 'Add a product', connect: 'Connect Telegram bot', manage: 'Manage products',
    createStore: 'Create your first store', empty: 'Nothing here yet', retry: 'Try again',
    search: 'Search products...', new: 'Add new', name: 'Name', description: 'Description',
    price: 'Price', stock: 'Stock', category: 'Category', sku: 'SKU',
    actions: 'Actions', save: 'Save changes', cancel: 'Cancel', edit: 'Edit',
    delete: 'Delete', publishedFlag: 'Published', draft: 'Draft', next: 'Next', previous: 'Previous',
    storeName: 'Store name', currency: 'Currency', botToken: 'Bot token from BotFather',
    connectBot: 'Connect bot', disconnect: 'Disconnect', connected: 'Connected',
    disconnected: 'Not connected', botHelp: 'Add your bot token to publish your product catalog through Telegram.',
    settingsTitle: 'Store settings', settingsSub: 'Your store name and base currency.',
    signOut: 'Sign out', account: 'Account', email: 'Email address',
    password: 'Password', fullName: 'Full name', login: 'Sign in',
    register: 'Create account', haveAccount: 'Already have an account?', noAccount: 'New to LootBot?',
    start: 'Get started', enter: 'Sign in to your store', createAccount: 'Create your account and set up your store',
    onboarding: 'Let’s set up your store', onboardingSub: 'Add your store and products, then connect the bot now or later.',
    firstProduct: 'Your first product', createFirstProduct: 'Add your first product',
    continue: 'Continue', skip: 'Skip for now', connectLater: 'You can connect your bot later from the dashboard.',
    store: 'Store', noStores: 'No stores yet', storesSub: 'All your stores, together.',
    create: 'Create store', confirmDelete: 'Delete this item?', currencyHint: 'Choose the currency used for your prices.',
    noActivity: 'Recent store changes will appear here.', serverError: 'We couldn’t load this data.',
    arabic: 'العربية', english: 'English', online: 'Online now', workspace: 'Workspace',
    signInCta: 'Sign in', featureOne: 'Your catalog on Telegram', featureTwo: 'Inventory made simple',
    featureThree: 'Product browsing through your bot', heroSub: 'Add products and connect a Telegram bot so customers can browse your catalog. Clear, secure store management without the busywork.',
    heroEyebrow: 'Selling tools for real merchants', trust: 'Everything your digital shop needs. Nothing it doesn’t.',
    walkthrough: 'From first product to a ready catalog', walkthroughSub: 'Clear tools that make the workday easier.',
    step1: 'Add your products', step2: 'Connect your bot', step3: 'Share your catalog',
    ctaEnd: 'Your store starts here.', footer: 'Made for the people who run the shop.',
    faqTitle: 'Frequently asked questions', faq1q: 'How do I connect a Telegram bot?',
    faq1a: 'Create a bot with BotFather, then paste its token into the Telegram page in your store dashboard. The token is encrypted at rest.',
    faq2q: 'Does LootBot support Arabic?',
    faq2a: 'Yes. The interface supports Arabic and right-to-left layout, with an English language option.',
    faq3q: 'Do I need a paid service to get started?',
    faq3a: 'You do not need an external payment provider or storefront platform to add products and connect your bot.',
    faq4q: 'What can customers do with the bot today?',
    faq4a: 'Customers can browse products and submit orders through the bot. Store owners manage order status, and the bot sends updates when connected; in-bot payment is not available yet.',
    orderPending: 'Pending', orderConfirmed: 'Confirmed', orderFulfilled: 'Fulfilled', orderCancelled: 'Cancelled',
    allOrders: 'All statuses', orderCustomer: 'Customer', orderItems: 'Items', orderTotal: 'Total',
    confirmOrder: 'Confirm order', fulfillOrder: 'Mark fulfilled', cancelOrder: 'Cancel order',
    cancelOrderConfirm: 'This cancels the order and returns its quantity to stock. Continue?',
    noOrders: 'No orders yet.', orderFlowNote: 'Payment happens outside LootBot. Record payment or refunds manually; record a refund before cancelling a paid order.',
    paidRevenue: 'Payments marked received', manualPaymentInstructions: 'Manual payment instructions',
    manualPaymentInstructionsHint: 'These instructions are sent to customers after they place an order. Payment happens outside LootBot.',
    paymentUnpaid: 'Unpaid', paymentPaid: 'Marked paid manually', paymentRefunded: 'Marked refunded manually',
    markPaid: 'Record payment received', markRefunded: 'Record refund issued',
    markPaidConfirm: 'Did you receive the payment outside LootBot?',
    markRefundedConfirm: 'Did you refund the customer outside LootBot?',
    paymentUpdatedAt: 'Payment updated',
  },
};
function useLocale() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('lootbot-locale') === 'en' ? 'en' : 'ar');
  useEffect(() => {
    const syncLocale = (event: Event) => {
      const next = (event as CustomEvent<Locale>).detail;
      if (next === 'ar' || next === 'en') setLocale(next);
    };
    window.addEventListener('lootbot:locale-change', syncLocale);
    return () => window.removeEventListener('lootbot:locale-change', syncLocale);
  }, []);
  const toggleLocale = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lootbot-locale', next);
    window.dispatchEvent(new CustomEvent('lootbot:locale-change', { detail: next }));
    setLocale(next);
  };
  return [locale, toggleLocale] as const;
}

function setHeadMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function SeoHead() {
  const [path] = useLocation();
  const [locale] = useLocale();
  useEffect(() => {
    const route = path.split('?')[0] || '/';
    const privateRoute =
      route.startsWith('/dashboard') ||
      route.startsWith('/onboarding') ||
      route === '/login' ||
      route === '/register' ||
      route !== '/';
    const page = route === '/login'
      ? { ar: ['دخول آمن إلى لوحة متجرك | LootBot', 'سجّل الدخول لإدارة متجرك ومنتجاتك على LootBot.'], en: ['Sign in to your store dashboard | LootBot', 'Sign in to manage your LootBot store and product catalog.'] }
      : route === '/register'
        ? { ar: ['أنشئ حساب متجرك على LootBot', 'أنشئ حسابًا لبدء إعداد متجر Telegram وإدارة منتجاتك باللغة العربية.'], en: ['Create your LootBot store account', 'Create an account to set up your Telegram store and manage your product catalog.'] }
        : route === '/'
          ? { ar: ['LootBot | أنشئ متجرك على Telegram', 'أنشئ كتالوج منتجاتك بالعربية، واربط بوت Telegram، وأدر المنتجات والتصنيفات من لوحة تحكم واحدة آمنة تدعم العربية والإنجليزية.'], en: ['LootBot | Build your Telegram storefront', 'Create a product catalog, connect a Telegram bot, and manage products and categories from one secure dashboard with Arabic and English support.'] }
          : { ar: ['صفحة غير موجودة | LootBot', 'الصفحة التي تبحث عنها غير متاحة في LootBot.'], en: ['Page not found | LootBot', 'The page you requested is not available in LootBot.'] };
    const [title, description] = page[locale];
    const canonicalUrl = new URL(route, window.location.origin).href;
    document.title = title;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    setHeadMeta('name', 'description', description);
    setHeadMeta('name', 'robots', privateRoute ? 'noindex, nofollow' : 'index, follow');
    setHeadMeta('property', 'og:title', title);
    setHeadMeta('property', 'og:description', description);
    setHeadMeta('property', 'og:type', 'website');
    setHeadMeta('property', 'og:url', canonicalUrl);
    setHeadMeta('property', 'og:image', new URL('/og-image.png', window.location.origin).href);
    setHeadMeta('name', 'twitter:title', title);
    setHeadMeta('name', 'twitter:description', description);
    setHeadMeta('name', 'twitter:image', new URL('/og-image.png', window.location.origin).href);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!privateRoute) {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
      }
      canonical.href = canonicalUrl;
    } else {
      canonical?.remove();
    }
  }, [path, locale]);
  return null;
}

function App() {
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);
  return <QueryClientProvider client={queryClient}><TooltipProvider>
    <SeoHead />
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login"><AuthPage mode="login" /></Route>
      <Route path="/register"><AuthPage mode="register" /></Route>
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard"><Dashboard /></Route>
      <Route path="/admin"><SuperAdminDashboard /></Route>
      <Route path="/dashboard/stores"><Dashboard><StoresPage locale="ar" t={copy.ar} /></Dashboard></Route>
      <Route path="/dashboard/products"><Dashboard><ProductsPage locale="ar" t={copy.ar} /></Dashboard></Route>
      <Route path="/dashboard/categories"><Dashboard><CategoriesPage locale="ar" t={copy.ar} /></Dashboard></Route>
      <Route path="/dashboard/orders"><Dashboard><OrdersPage locale="ar" t={copy.ar} /></Dashboard></Route>
      <Route path="/dashboard/telegram"><Dashboard><TelegramPage locale="ar" t={copy.ar} /></Dashboard></Route>
      <Route path="/dashboard/settings"><Dashboard><SettingsPage locale="ar" t={copy.ar} /></Dashboard></Route>
      <Route><NotFound /></Route>
    </Switch><Toaster />
  </TooltipProvider></QueryClientProvider>;
}

function Landing() {
  const [locale, toggleLocale] = useLocale();
  const t = copy[locale];
  const rtl = locale === 'ar';
  return <main dir={rtl ? 'rtl' : 'ltr'} className="min-h-[100dvh] overflow-hidden bg-[#11171c] text-[#e8efee]">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 md:px-10">
      <Link href="/" className="flex items-center gap-3 text-lg font-bold tracking-tight"><BrandMark /><span>lootbot<span className="text-[#64d7ae]">.</span></span></Link>
      <nav className="flex items-center gap-3 md:gap-7">
        <button onClick={toggleLocale} className="text-xs text-[#96a6a8] hover:text-white" data-testid="button-language">{rtl ? 'EN' : 'عربي'}</button>
        <Link href="/login" className="hidden text-sm text-[#bdc8c8] hover:text-white sm:block">{t.signInCta}</Link>
        <Link href="/register" className="rounded-xl bg-[#62d6aa] px-4 py-2.5 text-sm font-bold text-[#10231d] hover:bg-[#7be4bd]">{t.start}<ArrowLeft className="ms-2 inline h-4 w-4" /></Link>
      </nav>
    </header>
    <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-24 pt-12 md:grid-cols-[1.05fr_.95fr] md:px-10 md:pb-36 md:pt-20">
      <div className="relative z-10 fade-up">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#34423f] bg-[#1a2425] px-3.5 py-2 text-xs font-medium text-[#91d9bd]"><span className="h-1.5 w-1.5 rounded-full bg-[#62d6aa]" />{t.heroEyebrow}</p>
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.16] tracking-[-.045em] md:text-7xl">{rtl ? <>حوّل Telegram إلى<br /><span className="text-[#68dbb0]">متجر متكامل.</span></> : <>Turn Telegram into<br /><span className="text-[#68dbb0]">a complete store.</span></>}</h1>
        <p className="mt-7 max-w-xl text-base leading-8 text-[#a7b4b4] md:text-lg">{t.heroSub}</p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link href="/register" className="rounded-xl bg-[#62d6aa] px-6 py-3.5 text-sm font-bold text-[#10231d] transition-transform hover:-translate-y-0.5">{t.start}<ArrowLeft className="ms-3 inline h-4 w-4" /></Link>
          <span className="flex items-center gap-2 text-xs text-[#8d9c9c]"><ShieldCheck className="h-4 w-4 text-[#62d6aa]" />{rtl ? 'إعداد آمن، دون منصة متجر خارجية' : 'Secure setup without a separate storefront platform.'}</span>
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[530px] fade-up" style={{ animationDelay: '100ms' }}>
        <div className="absolute -inset-12 rounded-full bg-[#65d9ad]/[.07] blur-3xl" />
        <div className="relative rotate-[1deg] rounded-[26px] border border-[#31403f] bg-[#182123] p-3 shadow-2xl shadow-black/30">
          <div className="flex items-center justify-between border-b border-[#2a3738] px-4 py-3">
            <div className="flex items-center gap-2.5"><BrandMark small /><span className="text-xs font-semibold">lootbot / {rtl ? 'لوحة المتجر' : 'store dashboard'}</span></div>
            <div className="rounded-full bg-[#263433] px-2.5 py-1 text-[10px] text-[#a4b5b2]">{rtl ? 'معاينة الواجهة' : 'UI preview'}</div>
          </div>
          <div className="p-4 md:p-6" dir={rtl ? 'rtl' : 'ltr'}>
            <div className="flex items-end justify-between"><div><p className="text-[10px] text-[#899899]">{rtl ? 'معاينة لوحة المتجر' : 'STORE DASHBOARD PREVIEW'}</p><h3 className="mt-1 text-xl font-semibold">{rtl ? 'مساحة متجرك' : 'Your shop dashboard'}</h3></div><span className="text-[10px] text-[#72d6b3]">lootbot</span></div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[[rtl ? 'المنتجات' : 'Products', '—', ''], [rtl ? 'الطلبات' : 'Orders', '—', ''], [rtl ? 'الإيرادات' : 'Revenue', '—', ''], [rtl ? 'البوت' : 'Bot status', t.disconnected, '']].map(([label, val, symbol])=><div key={label} className="rounded-xl border border-[#2b393a] bg-[#1e292b] p-3.5"><p className="text-[10px] text-[#8e9d9f]">{label}</p><div className="mt-2 flex items-center justify-between text-base font-semibold">{val}<span className="text-xs text-[#69d8b0]">{symbol}</span></div></div>)}
            </div>
            <div className="mt-4 rounded-xl border border-[#2b393a] bg-[#1e292b] p-4">
              <div className="mb-3 flex justify-between text-[10px] text-[#93a0a1]"><span>{rtl ? 'كتالوج المنتجات' : 'PRODUCT CATALOG'}</span><span>{rtl ? 'بيانات متجرك' : 'YOUR STORE DATA'}</span></div>
              <div className="flex h-[88px] items-center justify-center gap-2 rounded-lg border border-dashed border-[#354344] text-xs text-[#91a09f]"><Activity className="h-4 w-4 text-[#69d8b0]"/>{rtl ? 'ستظهر بياناتك بعد إعداد المتجر' : 'Your store data appears after setup'}</div>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#2b393a] p-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#213d34] text-[#69d8b0]"><ShoppingBag className="h-4 w-4" /></div><div className="flex-1"><p className="text-[11px] font-medium">{rtl ? 'طلباتك ستظهر هنا' : 'Your orders will appear here'}</p><p className="mt-0.5 text-[9px] text-[#849294]">{rtl ? 'اربط بوت Telegram للبدء' : 'Connect Telegram to get started'}</p></div><ArrowLeft className="h-4 w-4 text-[#8dddc1]"/></div>
          </div>
        </div>
      </div>
    </section>
    <section className="border-y border-[#293435] bg-[#141c20] py-10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-5 md:flex-row md:items-center md:px-10"><p className="max-w-sm text-sm leading-6 text-[#bdc8c8]">{t.trust}</p><div className="flex flex-wrap gap-x-8 gap-y-3 text-xs text-[#879697]">{[t.featureOne,t.featureTwo,t.featureThree].map((f,i)=><span key={f} className="flex items-center gap-2"><Check className="h-4 w-4 text-[#62d6aa]" />{f}</span>)}</div></div></section>
    <section className="mx-auto max-w-7xl px-5 py-24 md:px-10 md:py-32"><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#64d7ae]">{rtl ? 'مساحة عملك' : 'YOUR WORKSPACE'}</p><div className="mt-4 grid gap-10 md:grid-cols-[.8fr_1.2fr]"><h2 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{t.walkthrough}</h2><p className="max-w-md self-end leading-7 text-[#96a5a6]">{t.walkthroughSub}</p></div>
      <div className="mt-14 grid border-t border-[#2c393a] md:grid-cols-3">{[[t.step1,'01','ضبط الكتالوج وتفاصيل كل منتج.'],[t.step2,'02','اربط بوتك الخاص بأمان.'],[t.step3,'03','شارك الكتالوج ليتمكن عملاؤك من استعراض المنتجات.']].map(([title,note,desc])=><article key={note} className="border-b border-[#2c393a] py-7 md:border-b-0 md:border-e md:px-7 md:first:ps-0"><span className="font-mono text-xs text-[#69d8b0]">{note}</span><h3 className="mt-6 text-xl font-semibold">{title}</h3><p className="mt-3 max-w-xs text-sm leading-6 text-[#91a0a1]">{rtl ? desc : note==='01'?'Keep your catalog and product details organized.':note==='02'?'Securely connect your own Telegram bot.':'Share your catalog so customers can browse your products.'}</p></article>)}</div>
    </section>
    <section className="mx-auto max-w-7xl px-5 pb-24 md:px-10"><div className="relative overflow-hidden rounded-3xl border border-[#344440] bg-[#182522] px-6 py-14 text-center md:py-20"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(91,207,163,.12),transparent_55%)]" /><div className="relative"><Zap className="mx-auto h-6 w-6 text-[#69d8b0]" /><h2 className="mt-5 text-3xl font-semibold md:text-5xl">{t.ctaEnd}</h2><Link href="/register" className="mt-8 inline-flex items-center rounded-xl bg-[#62d6aa] px-6 py-3 text-sm font-bold text-[#10231d]">{t.start}<ArrowLeft className="ms-3 h-4 w-4" /></Link></div></div></section>
    <section className="mx-auto max-w-7xl px-5 pb-24 md:px-10">
      <h2 className="text-3xl font-semibold md:text-4xl">{t.faqTitle}</h2>
      <div className="mt-8 divide-y divide-[#2b3839] border-y border-[#2b3839]">
        {[[t.faq1q,t.faq1a],[t.faq2q,t.faq2a],[t.faq3q,t.faq3a],[t.faq4q,t.faq4a]].map(([question,answer]) =>
          <details key={question} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold marker:hidden">
              {question}<ChevronDown className="h-4 w-4 shrink-0 text-[#69d8b0] transition-transform group-open:rotate-180"/>
            </summary>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[#99a6a6]">{answer}</p>
          </details>
        )}
      </div>
    </section>
    <footer className="mx-auto flex max-w-7xl items-center justify-between px-5 py-7 text-xs text-[#839091] md:px-10"><Link href="/" className="flex items-center gap-2"><BrandMark small />lootbot</Link><span>{t.footer}</span><span>© LootBot</span></footer>
  </main>;
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`grid place-items-center rounded-xl bg-[#63d7aa] text-[#10231d] ${small?'h-7 w-7 rounded-lg':'h-9 w-9'}`}><Command className={small?'h-4 w-4':'h-5 w-5'} /></span>;
}
function authErrorMessage(error: unknown, locale: Locale): string {
  const candidate = error && typeof error === 'object' ? error as { status?: unknown; data?: unknown } : {};
  const status = typeof candidate.status === 'number' ? candidate.status : 0;
  const payload = candidate.data && typeof candidate.data === 'object' ? candidate.data as Record<string, unknown> : {};
  const detail = typeof payload.error === 'string' ? payload.error : '';
  if (locale === 'ar') {
    if (detail) return detail;
    if (status === 401) return 'بيانات الدخول غير صحيحة. تحقق من البريد وكلمة المرور.';
    if (status === 403) return 'تعذر التحقق من حماية الطلب. حدّث الصفحة وحاول مجددًا.';
    if (status === 429) return 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.';
    if (status >= 500 || status === 0) return 'تعذر الاتصال بالخادم الآن. تحقق من اتصالك وحاول مجددًا.';
    return 'تعذر إكمال الطلب. راجع البيانات وحاول مجددًا.';
  }
  if (status === 401) return 'Email or password is incorrect. Check your sign-in details.';
  if (status === 403) return 'Security check failed. Reload the page and try again.';
  if (status === 429) return 'Too many attempts. Wait a moment, then try again.';
  if (status >= 500 || status === 0) return 'The server is unavailable right now. Check your connection and try again.';
  if (status === 409) return 'An account with these details could not be created.';
  return 'Could not complete the request. Check your details and try again.';
}
function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [locale,toggleLocale]=useLocale(); const t=copy[locale]; const rtl=locale==='ar';
  const [,navigate]=useLocation(); const qc=useQueryClient(); const csrf=useGetCsrfToken();
  const csrfHeader=csrf.data?.token ? { 'x-csrf-token': csrf.data.token } : undefined;
  const login=useLoginUser({request:{headers:csrfHeader}}); const register=useRegisterUser({request:{headers:csrfHeader}});
  const [error,setError]=useState(''); const [showPassword,setShowPassword]=useState(false);
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const fd=new FormData(e.currentTarget);const email=String(fd.get('email'));const password=String(fd.get('password'));
    if(mode==='login') login.mutate({data:{email,password}},{onSuccess:(data)=>{qc.setQueryData(getGetCsrfTokenQueryKey(),{token:data.csrfToken});qc.setQueryData(getGetCurrentUserQueryKey(),data.user);void qc.invalidateQueries({queryKey:getGetCurrentUserQueryKey()});navigate(data.user.role==='SUPERADMIN'?'/admin':'/dashboard');},onError:(err)=>setError(authErrorMessage(err,locale))});
    else register.mutate({data:{name:String(fd.get('name')),email,password}},{onSuccess:(data)=>{qc.setQueryData(getGetCsrfTokenQueryKey(),{token:data.csrfToken});void qc.invalidateQueries({queryKey:getGetCurrentUserQueryKey()});navigate('/onboarding');},onError:(err)=>setError(authErrorMessage(err,locale))});
  };
  const pending=login.isPending||register.isPending;
  return <main dir={rtl?'rtl':'ltr'} className="grid min-h-[100dvh] bg-[#11171c] text-[#e8efee] md:grid-cols-[1fr_.9fr]">
    <aside className="relative hidden flex-col justify-between overflow-hidden border-e border-[#273436] bg-[#151e20] p-10 md:flex"><Link href="/" className="flex items-center gap-3"><BrandMark/><span className="text-lg font-bold">lootbot<span className="text-[#64d7ae]">.</span></span></Link>
      <div className="relative z-10 max-w-lg"><p className="text-xs uppercase tracking-[.16em] text-[#66d8af]">{t.heroEyebrow}</p><h1 className="mt-5 text-5xl font-semibold leading-tight">{rtl?'بيعك يبدأ من هنا.':'Your shop starts here.'}</h1><p className="mt-5 max-w-md leading-7 text-[#9baaaa]">{t.heroSub}</p><div className="mt-10 space-y-4">{[t.featureOne,t.featureTwo,t.featureThree].map(x=><p key={x} className="flex items-center gap-3 text-sm text-[#c1cbca]"><Check className="h-4 w-4 text-[#67d8af]"/>{x}</p>)}</div></div>
      <div className="absolute -bottom-24 -left-20 h-96 w-96 rounded-full bg-[#66d8af]/[.06] blur-3xl" /><p className="text-xs text-[#758485]">© LootBot · {t.footer}</p>
    </aside>
    <section className="flex min-h-[100dvh] flex-col px-5 py-6 md:px-12"><header className="flex items-center justify-between"><Link href="/" className="flex items-center gap-2 md:hidden"><BrandMark small/><b>lootbot</b></Link><span className="md:ms-auto" /><button onClick={toggleLocale} className="text-xs text-[#9aa8a8] hover:text-white" data-testid="button-language">{rtl?'EN':'العربية'}</button></header>
      <div className="mx-auto my-auto w-full max-w-[420px] py-10 fade-up"><Link href="/" className="hidden items-center gap-2 text-xs text-[#94a3a4] hover:text-white md:inline-flex"><ArrowRight className="h-4 w-4"/>{rtl?'العودة إلى الرئيسية':'Back to home'}</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[.17em] text-[#66d8af]">{t.account}</p><h1 className="mt-3 text-3xl font-semibold">{mode==='login'?t.enter:t.createAccount}</h1>
        <form className="mt-8 space-y-5" onSubmit={submit}>
          {mode==='register'&&<Field label={t.fullName} name="name" autoComplete="name" required placeholder={rtl?'مثال: سارة أحمد':'e.g. Sara Ahmed'}/>}
          <Field label={t.email} name="email" type="email" autoComplete="email" required placeholder="you@shop.com"/>
          <div><label className="mb-2 block text-sm text-[#c4cecd]">{t.password}</label><div className="relative"><input name="password" type={showPassword?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} minLength={8} required placeholder="••••••••" className="h-12 w-full rounded-xl border border-[#354344] bg-[#182123] px-4 pe-12 text-sm outline-none transition focus:border-[#62d6aa] focus:ring-2 focus:ring-[#62d6aa]/10" data-testid="input-password"/><button type="button" aria-label="Toggle password visibility" onClick={()=>setShowPassword(!showPassword)} className="absolute end-3 top-3 text-[#829192]">{showPassword?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button></div></div>
          {error&&<p role="alert" className="rounded-lg border border-[#743b3b] bg-[#3b2223] px-3 py-2 text-sm text-[#f1a7a3]">{error}</p>}
          <button disabled={pending||!csrf.data?.token} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#62d6aa] text-sm font-bold text-[#10231d] transition hover:bg-[#79e3bb] disabled:opacity-50" data-testid="button-submit">{pending?<span className="animate-pulse">{rtl?'جارٍ الإرسال...':'Working...'}</span>:mode==='login'?t.login:t.register}<ArrowLeft className="h-4 w-4"/></button>
          {csrf.isError&&<p className="text-xs text-[#869494]">{rtl?'تعذر الحصول على رمز الحماية. أعد تحميل الصفحة ثم حاول مجددًا.':'Could not load the security token. Reload the page and try again.'}</p>}
        </form>
        <p className="mt-7 text-center text-sm text-[#9aa8a8]">{mode==='login'?t.noAccount:t.haveAccount} <Link href={mode==='login'?'/register':'/login'} className="font-semibold text-[#70dcb5] hover:text-[#a1efd1]">{mode==='login'?t.register:t.login}</Link></p>
        <div className="mt-9 flex items-center justify-center gap-2 text-[11px] text-[#758485]"><ShieldCheck className="h-4 w-4 text-[#61c99f]"/>{rtl?'بيانات متجرك تبقى خاصة وآمنة.':'Your store credentials stay private.'}</div>
      </div>
    </section>
  </main>;
}

type AdminOverview = {
  stats: { users: number; stores: number; activeStores: number; connectedBots: number; orders: number; products: number };
  recordedRevenueByCurrency: Array<{ currency: string; amount: number }>;
  users: Array<{ id: string; name: string; email: string; role: string; createdAt: string }>;
  stores: Array<{ id: string; name: string; slug: string; currency: string; botStatus: string; plan: 'FREE' | 'PRO' | 'BUSINESS'; createdAt: string; updatedAt: string; ownerName: string; ownerEmail: string }>;
  events: Array<{ id: string; action: string; summary: string; createdAt: string }>;
};
type AdminHealth = { api: string; database: string; telegramBots: { connected: number; withErrors: number }; recentErrors: Array<{ occurredAt: string; method: string; path: string; errorType: string }>; checkedAt: string };

type PlanDefinitionView = { name: string; limits: Record<string, number>; features: Record<string, boolean> };
function PlanMatrix({ rtl, csrfToken }: { rtl: boolean; csrfToken?: string }) {
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const plans = useQuery({ queryKey: ['/api/admin/plans'], queryFn: async () => { const response = await fetch('/api/admin/plans', { credentials: 'include' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<{ catalog: Record<'FREE'|'PRO'|'BUSINESS', PlanDefinitionView>; planCounts: Record<'FREE'|'PRO'|'BUSINESS', number>; featureMetadata: Record<string, { requiredPlan: string; description: string }>; configurableFeatures: string[] }>; } });
  const [drafts, setDrafts] = useState<Partial<Record<'FREE'|'PRO'|'BUSINESS', PlanDefinitionView>>>({});
  useEffect(() => { if (plans.data) setDrafts(plans.data.catalog); }, [plans.data]);
  const save = async (code: 'FREE'|'PRO'|'BUSINESS') => {
    if (!csrfToken || !drafts[code]) return;
    setError(''); setSaved('');
    const response = await fetch(`/api/admin/plans/${code}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ definition: drafts[code] }) });
    if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: string } | null; setError(payload?.error || (rtl ? 'تعذر حفظ إعدادات الباقة.' : 'Could not save plan settings.')); return; }
    setSaved(code); await plans.refetch();
  };
  if (plans.isLoading) return <section className="mt-8 rounded-2xl border border-[#293638] bg-[#171f22] p-5 text-sm text-[#9aa8a7]">{rtl ? 'جارٍ تحميل مصفوفة الباقات…' : 'Loading plan matrix…'}</section>;
  if (plans.isError || !plans.data) return <section className="mt-8"><ErrorPanel message={rtl ? 'تعذر تحميل إعدادات الباقات.' : 'Could not load plan settings.'} onRetry={() => void plans.refetch()} /></section>;
  const limitKeys = Object.keys(plans.data.catalog.FREE.limits);
  return <section className="mt-8 rounded-2xl border border-[#293638] bg-[#171f22] p-5"><h2 className="text-lg font-semibold">{rtl ? 'مصفوفة الخطط والميزات' : 'Plans and feature matrix'}</h2><p className="mt-1 text-xs text-[#899898]">{rtl ? 'تُطبق الحدود وحواجز الميزات مباشرة على طلبات API. الميزات غير المنفذة معروضة للشفافية ومقفلة.' : 'Limits and feature gates are enforced by the API. Unimplemented features remain visible but locked.'}</p>{error && <div className="mt-3"><InlineError message={error}/></div>}<div className="mt-4 grid gap-4 lg:grid-cols-3">{(['FREE','PRO','BUSINESS'] as const).map(code => { const def = drafts[code] || plans.data!.catalog[code]; return <article key={code} className="rounded-xl border border-[#2b393a] bg-[#11191b] p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{code}</h3><span className="text-xs text-[#839191]">{plans.data!.planCounts[code]} {rtl ? 'متجر' : 'stores'}</span></div><label className="mt-3 block text-xs text-[#96a4a3]">{rtl ? 'اسم الخطة' : 'Plan name'}<input value={def.name} onChange={e => setDrafts(curr => ({ ...curr, [code]: { ...def, name: e.target.value } }))} className="mt-1 h-9 w-full rounded-lg border border-[#354344] bg-[#182123] px-2 text-sm"/></label><div className="mt-3 space-y-2">{limitKeys.map(key => <label key={key} className="flex items-center justify-between gap-2 text-xs text-[#96a4a3]"><span>{key}</span><input type="number" min={1} max={1000000} value={def.limits[key]} onChange={e => setDrafts(curr => ({ ...curr, [code]: { ...def, limits: { ...def.limits, [key]: Number(e.target.value) } } }))} className="h-8 w-28 rounded-lg border border-[#354344] bg-[#182123] px-2 font-mono"/></label>)}</div><div className="mt-4 space-y-2 border-t border-[#2a3739] pt-3">{Object.entries(def.features).map(([key, enabled]) => { const configurable = plans.data!.configurableFeatures.includes(key); return <label key={key} className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={!configurable} checked={enabled} onChange={e => setDrafts(curr => ({ ...curr, [code]: { ...def, features: { ...def.features, [key]: e.target.checked } } }))} className="mt-0.5 accent-[#62d6aa] disabled:opacity-50"/><span><span className="text-[#d0d9d7]">{key}</span><span className="block text-[#839191]">{plans.data!.featureMetadata[key]?.description}{!configurable && (rtl ? ' · غير منفذة بعد' : ' · not implemented yet')}</span></span></label>; })}</div><button onClick={() => void save(code)} disabled={!csrfToken} className="mt-4 w-full rounded-lg bg-[#62d6aa] px-3 py-2 text-xs font-bold text-[#10231d] disabled:opacity-50">{saved === code ? (rtl ? 'تم الحفظ' : 'Saved') : (rtl ? 'حفظ الخطة' : 'Save plan')}</button></article>; })}</div></section>;
}

function SuperAdminDashboard() {
  const [locale, toggleLocale] = useLocale();
  const rtl = locale === 'ar';
  const user = useGetCurrentUser();
  const csrf = useGetCsrfToken();
  const logout = useLogoutUser({ request: { headers: csrf.data?.token ? { 'x-csrf-token': csrf.data.token } : undefined } });
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [planError, setPlanError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const overview = useQuery({
    queryKey: ['/api/admin/overview'],
    enabled: user.data?.role === 'SUPERADMIN',
    queryFn: async (): Promise<AdminOverview> => {
      const response = await fetch('/api/admin/overview', { credentials: 'include' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      return response.json() as Promise<AdminOverview>;
    },
  });
  const health = useQuery({
    queryKey: ['/api/admin/health'],
    enabled: user.data?.role === 'SUPERADMIN',
    queryFn: async (): Promise<AdminHealth> => {
      const response = await fetch('/api/admin/health', { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<AdminHealth>;
    },
    refetchInterval: 60_000,
  });
  const assignPlan = async (storeId: string, plan: 'FREE' | 'PRO' | 'BUSINESS') => {
    setPlanError('');
    const response = await fetch(`/api/admin/stores/${encodeURIComponent(storeId)}/plan`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(csrf.data?.token ? { 'x-csrf-token': csrf.data.token } : {}) },
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      setPlanError(payload?.error || (rtl ? 'تعذر تحديث الباقة.' : 'Could not update the plan.'));
      return;
    }
    await overview.refetch();
  };
  const signOut = () => { if (!csrf.data?.token) return; logout.mutate(undefined, { onSuccess: () => { qc.clear(); navigate('/login'); } }); };
  if (user.isLoading) return <LoadingScreen />;
  if (user.isError || !user.data) return <AuthRequired locale={locale} />;
  if (user.data.role !== 'SUPERADMIN') return <div className="grid min-h-[100dvh] place-items-center bg-[#11171c] text-[#e8efee]"><div className="text-center"><p>{rtl ? 'هذه الصفحة للمشرف العام فقط.' : 'This page is only available to super admins.'}</p><Link href="/dashboard" className="mt-4 inline-flex rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d]">{rtl ? 'لوحة المتجر' : 'Store dashboard'}</Link></div></div>;
  const stats = overview.data?.stats;
  const labels = rtl ? [['المستخدمون', stats?.users], ['المتاجر', stats?.stores], ['متاجر نشطة', stats?.activeStores], ['بوتات متصلة', stats?.connectedBots], ['الطلبات', stats?.orders], ['المنتجات', stats?.products]] : [['Users', stats?.users], ['Stores', stats?.stores], ['Active stores', stats?.activeStores], ['Connected bots', stats?.connectedBots], ['Orders', stats?.orders], ['Products', stats?.products]];
  const visibleUsers = overview.data?.users.filter((item) => `${item.name} ${item.email}`.toLocaleLowerCase().includes(userSearch.trim().toLocaleLowerCase())) ?? [];
  return <main dir={rtl ? 'rtl' : 'ltr'} className="min-h-[100dvh] bg-[#11171c] p-5 text-[#e8efee] md:p-9">
    <header className="mx-auto flex max-w-7xl items-center gap-4 border-b border-[#293638] pb-5"><BrandMark/><div className="min-w-0 flex-1"><p className="text-xs text-[#6dd9b1]">LootBot</p><h1 className="mt-1 text-xl font-semibold">{rtl ? 'لوحة المشرف العام' : 'Super Admin'}</h1></div><button onClick={toggleLocale} className="rounded-lg px-3 py-2 text-xs text-[#aab6b5] hover:bg-[#1b2527]">{rtl ? 'EN' : 'العربية'}</button><button onClick={signOut} disabled={logout.isPending || !csrf.data?.token} className="rounded-lg border border-[#354344] px-3 py-2 text-xs text-[#c4cecd] hover:bg-[#1b2527] disabled:opacity-50">{rtl ? 'تسجيل الخروج' : 'Sign out'}</button></header>
    <div className="mx-auto max-w-7xl">
      <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-3">{labels.map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-[#293638] bg-[#171f22] p-5"><p className="text-xs text-[#94a2a2]">{label}</p><p className="mt-3 font-mono text-3xl font-bold">{overview.isLoading ? '—' : value ?? '—'}</p></article>)}</div>
      {overview.isError && <ErrorPanel message={rtl ? 'تعذر تحميل بيانات الإدارة.' : 'Could not load admin data.'} onRetry={() => void overview.refetch()} />}
      <PlanMatrix rtl={rtl} csrfToken={csrf.data?.token}/>
      <section className="mt-8 rounded-2xl border border-[#293638] bg-[#171f22] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{rtl ? 'صحة النظام' : 'System health'}</h2><button onClick={() => void health.refetch()} className="rounded-lg border border-[#354344] px-3 py-2 text-xs">{rtl ? 'تحديث' : 'Refresh'}</button></div>{health.isError ? <ErrorPanel message={rtl ? 'تعذر فحص صحة النظام.' : 'Could not check system health.'} onRetry={() => void health.refetch()} /> : <div className="mt-4 grid gap-3 sm:grid-cols-3"><StatusPill value={`API ${health.data?.api ?? '…'}`}/><StatusPill value={`DB ${health.data?.database ?? '…'}`}/><p className="text-xs text-[#a7b2b1]">{rtl ? 'بوتات متصلة' : 'Connected bots'}: {health.data?.telegramBots.connected ?? '—'} · {rtl ? 'أخطاء البوتات' : 'Bot errors'}: {health.data?.telegramBots.withErrors ?? '—'}</p></div>}{!!health.data?.recentErrors.length && <div className="mt-4 space-y-2">{health.data.recentErrors.slice(0, 5).map((error, index) => <p key={`${error.occurredAt}-${index}`} className="text-xs text-[#df9a91]">{error.method} {error.path} · {error.errorType} · {new Date(error.occurredAt).toLocaleString(rtl ? 'ar' : 'en')}</p>)}</div>}</section>
      {!!overview.data?.recordedRevenueByCurrency.length && <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">{rtl ? 'إيرادات مسجلة حسب العملة' : 'Recorded revenue by currency'}</h2><div className="flex flex-wrap gap-3">{overview.data.recordedRevenueByCurrency.map((item) => <p key={item.currency} className="rounded-xl border border-[#293638] bg-[#171f22] px-4 py-3 font-mono text-sm">{new Intl.NumberFormat(rtl ? 'ar-SA' : 'en', { style: 'currency', currency: item.currency }).format(item.amount)}</p>)}</div></section>}
      <section className="mt-8"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5 text-[#70dcb5]"/>{rtl ? 'المستخدمون (الأحدث 50)' : 'Recent users (latest 50)'}</h2><input type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder={rtl ? 'ابحث بالاسم أو البريد' : 'Search name or email'} className="h-10 rounded-xl border border-[#2f3c3e] bg-[#171f22] px-3 text-sm outline-none focus:border-[#61d5a9]" /></div><div className="overflow-x-auto rounded-2xl border border-[#293638]"><table className="w-full min-w-[600px] text-start text-sm"><thead className="bg-[#1b2527] text-xs text-[#899898]"><tr>{(rtl ? ['الاسم', 'البريد الإلكتروني', 'الدور', 'تاريخ التسجيل'] : ['Name', 'Email', 'Role', 'Joined']).map(x => <th key={x} className="px-4 py-3 text-start font-medium">{x}</th>)}</tr></thead><tbody className="divide-y divide-[#293638]">{visibleUsers.map(item => <tr key={item.id} className="bg-[#171f22]"><td className="px-4 py-3 font-medium">{item.name}</td><td className="px-4 py-3 text-[#9aa8a7]">{item.email}</td><td className="px-4 py-3"><StatusPill value={item.role}/></td><td className="px-4 py-3 text-xs text-[#899898]">{new Date(item.createdAt).toLocaleDateString(rtl ? 'ar' : 'en')}</td></tr>)}{!overview.isLoading && !visibleUsers.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-[#899898]">{rtl ? 'لا توجد نتائج.' : 'No matching users.'}</td></tr>}</tbody></table></div></section>
      <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">{rtl ? 'المتاجر والباقات' : 'Stores and plans'}</h2>{planError&&<InlineError message={planError}/>}<div className="overflow-x-auto rounded-2xl border border-[#293638]"><table className="w-full min-w-[900px] text-start text-sm"><thead className="bg-[#1b2527] text-xs text-[#899898]"><tr>{(rtl ? ['المتجر', 'المالك', 'العملة', 'البوت', 'الباقة'] : ['Store', 'Owner', 'Currency', 'Bot', 'Plan']).map(x => <th key={x} className="px-4 py-3 text-start font-medium">{x}</th>)}</tr></thead><tbody className="divide-y divide-[#293638]">{overview.data?.stores.map(item => <tr key={item.id} className="bg-[#171f22]"><td className="px-4 py-3"><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-[#829091]">{item.slug}</p></td><td className="px-4 py-3"><p>{item.ownerName}</p><p className="mt-1 text-xs text-[#829091]">{item.ownerEmail}</p></td><td className="px-4 py-3">{item.currency}</td><td className="px-4 py-3"><StatusPill value={item.botStatus}/></td><td className="px-4 py-3"><select aria-label={rtl ? `باقة ${item.name}` : `${item.name} plan`} value={item.plan} onChange={(event) => void assignPlan(item.id, event.target.value as 'FREE'|'PRO'|'BUSINESS')} disabled={!csrf.data?.token} className="rounded-lg border border-[#354344] bg-[#182123] px-3 py-2 text-xs">{(['FREE','PRO','BUSINESS'] as const).map(plan => <option key={plan} value={plan}>{plan}</option>)}</select></td></tr>)}{!overview.isLoading && !overview.data?.stores.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-[#899898]">{rtl ? 'لا توجد متاجر.' : 'No stores yet.'}</td></tr>}</tbody></table></div></section>
    </div>
  </main>;
}

function Dashboard({ children }: { children?: ReactNode }) {
  const [locale,toggleLocale]=useLocale(); const t=copy[locale]; const rtl=locale==='ar';
  const user=useGetCurrentUser(); const stores=useListStores(); const csrf=useGetCsrfToken(); const logout=useLogoutUser({request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}}); const qc=useQueryClient();
  const [location,navigate]=useLocation(); const [mobileOpen,setMobileOpen]=useState(false);
  const [activeStore,setActiveStore]=useState('');
  const storeList=stores.data||[];
  useEffect(()=>{if(storeList[0]&&(!activeStore||!storeList.some(item=>item.id===activeStore)))setActiveStore(storeList[0].id);},[storeList,activeStore]);
  const store=storeList.find((s)=>s.id===activeStore)||storeList[0];
  const nav=[['/dashboard',t.overview,LayoutDashboard],['/dashboard/stores',t.stores,StoreIcon],['/dashboard/products',t.products,Package],['/dashboard/categories',t.categories,Tag],['/dashboard/orders',t.orders,ShoppingBag],['/dashboard/telegram',t.telegram,MessageCircle],['/dashboard/settings',t.settings,Settings2]] as const;
  if(user.isLoading) return <LoadingScreen />;
  if(user.isError||!user.data) return <AuthRequired locale={locale}/>;
  const logoutAction=()=>{if(!csrf.data?.token)return;logout.mutate(undefined,{onSuccess:()=>{qc.clear();navigate('/login');}});};
  return <div dir={rtl?'rtl':'ltr'} className="merchant-console min-h-[100dvh] bg-[#11171c] text-[#e6edec]">
    {mobileOpen&&<button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={()=>setMobileOpen(false)} />}
    <aside className={`console-sidebar fixed inset-y-0 z-40 flex w-[258px] flex-col overflow-y-auto border-e border-[#253134] bg-[#131b1e] px-4 py-5 transition-transform md:translate-x-0 ${rtl?'right-0':'left-0'} ${mobileOpen?'translate-x-0':rtl?'translate-x-full':'-translate-x-full'} md:!translate-x-0`}>
      <div className="flex items-center justify-between"><Link href="/dashboard" className="flex items-center gap-3 px-2"><BrandMark/><span className="text-lg font-bold">lootbot<span className="text-[#64d7ae]">.</span></span></Link><button aria-label={rtl?'إغلاق القائمة':'Close navigation'} onClick={()=>setMobileOpen(false)} className="rounded-lg p-2 md:hidden"><X className="h-5 w-5"/></button></div>
      <div className="mt-9 px-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#728183]">{t.workspace}</div>
      <div className="relative mt-3"><select value={store?.id||''} onChange={(e)=>setActiveStore(e.target.value)} className="h-11 w-full appearance-none rounded-xl border border-[#303d3f] bg-[#1a2426] px-3 pe-9 text-sm font-medium outline-none focus:border-[#61d5a9]" aria-label={t.store} data-testid="select-store"><option value="" disabled>{t.noStores}</option>{storeList.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><ChevronDown className="pointer-events-none absolute end-3 top-3 h-4 w-4 text-[#829293]"/></div>
      <nav aria-label={rtl?'تنقل لوحة التحكم':'Dashboard navigation'} className="console-navigation mt-7 space-y-1">{nav.map(([href,label,Icon])=><Link key={href} href={href} aria-current={location===href?'page':undefined} onClick={()=>setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${location===href?'bg-[#20362f] font-semibold text-[#7ce1bb]':'text-[#a1afae] hover:bg-[#1b2527] hover:text-white'}`}><Icon className="h-[18px] w-[18px]"/>{label}{location===href&&<span className="ms-auto h-1.5 w-1.5 rounded-full bg-[#6bd9b0]"/>}</Link>)}</nav>
      <div className="mt-auto rounded-2xl border border-[#2b3938] bg-[#182321] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#c6d2cf]"><CircleHelp className="h-4 w-4 text-[#65d7ad]"/>{rtl?'تحتاج مساعدة؟':'Need a hand?'}</div><p className="mt-2 text-[11px] leading-5 text-[#859492]">{rtl?'إدارة متجرك أسهل مع دليل البداية.':'Your store setup, one clear step at a time.'}</p><Link href="/onboarding" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#70dcb5]">{rtl?'دليل الإعداد':'Setup guide'}<ArrowLeft className="h-3.5 w-3.5"/></Link></div>
      <div className="mt-4 flex items-center gap-3 border-t border-[#283436] px-2 pt-4"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#29483d] text-sm font-semibold text-[#8ce4c3]">{user.data.name.slice(0,1)}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.data.name}</p><p className="truncate text-[10px] text-[#7e8d8e]">{user.data.email}</p></div><button aria-label={t.signOut} onClick={logoutAction} disabled={logout.isPending||!csrf.data?.token} className="rounded-lg p-2 text-[#889697] hover:bg-[#263335] hover:text-white disabled:opacity-50" data-testid="button-logout"><LogOut className="h-4 w-4"/></button></div>
    </aside>
    <main className={`${rtl?'md:mr-[258px]':'md:ml-[258px]'} min-h-[100dvh]`}>
      <header className="console-topbar sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-[#263235] bg-[#11171c]/95 px-4 backdrop-blur md:px-9">
        <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-[#98a7a7] hover:bg-[#202a2d] md:hidden" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5"/></button><div><p className="text-xs text-[#839191]">{store?.name||t.store}</p><p className="mt-0.5 text-sm font-semibold">{nav.find(n=>n[0]===location)?.[1]||t.dashboard}</p></div></div>
        <div className="flex items-center gap-3"><button onClick={toggleLocale} className="rounded-lg border border-[#303d3f] px-3 py-2 text-xs text-[#a5b2b1] hover:text-white" data-testid="button-language">{rtl?'EN':'العربية'}</button><span className="hidden h-8 w-px bg-[#2c383a] sm:block"/><div className="hidden items-center gap-2 text-xs text-[#92a09f] sm:flex"><ShieldCheck className="h-4 w-4 text-[#62d6aa]"/>{t.account}</div></div>
      </header>
      <div className="console-content mx-auto max-w-[1420px] p-4 md:p-9">{children ? cloneElement(children as ReactElement<any>,{store,locale,t}) : <DashboardHome store={store} locale={locale} t={t}/>}</div>
    </main>
  </div>;
}

function DashboardHome({store,locale,t}:{store?:Store;locale:Locale;t:typeof copy.ar}) {
  const rtl=locale==='ar'; const [,navigate]=useLocation(); const storeId=store?.id||'';
  const summary=useGetDashboardSummary({storeId},{query:{enabled:!!storeId,queryKey:getGetDashboardSummaryQueryKey({storeId})}});
  const events=useGetDashboardActivity({storeId,limit:8},{query:{enabled:!!storeId,queryKey:getGetDashboardActivityQueryKey({storeId,limit:8})}});
  const bot=useGetStoreBot(storeId,{query:{enabled:!!storeId,queryKey:getGetStoreBotQueryKey(storeId)}});
  const data=summary.data;
  const customerName=useGetCurrentUserName();
  if(!store)return <EmptyPanel title={t.noStores} detail={t.storesSub} action={t.createStore} onAction={()=>navigate('/dashboard/stores')}/>;
  const numbers=[[t.productsTotal,data?.productCount,'#64d6a9',Package],[t.published,data?.publishedProductCount,'#e5a35e',Eye],[t.categoriesTotal,data?.categoryCount,'#88a7db',Tag],[t.sales,data?.orderCount,'#d28dc4',ShoppingBag],[t.paidRevenue,new Intl.NumberFormat(rtl?'ar-SA':'en-US',{style:'currency',currency:store.currency}).format(data?.revenue??0),'#72c7bd',CircleDollarSign]] as const;
  return <div className="fade-up">
    <div className="console-welcome mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs text-[#879696]">{t.welcome}، {customerName}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{store.name}</h1><p className="mt-2 text-sm text-[#889797]">{t.tagline}</p></div><div className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${bot.data?.connected?'border-[#32614e] bg-[#1b342a] text-[#7fddb8]':'border-[#594b37] bg-[#30291f] text-[#e0b87d]'}`}><span className={`h-2 w-2 rounded-full ${bot.data?.connected?'bg-[#69d9ae]':'bg-[#d6a65e]'}`}/>{bot.data?.connected?t.connected:t.disconnected}<button onClick={()=>navigate('/dashboard/telegram')} className="ms-1 underline decoration-[#617069] underline-offset-2">{rtl?'إدارة':'Manage'}</button></div></div>
    {summary.isError&&<ErrorPanel message={t.serverError} onRetry={()=>void summary.refetch()}/>}
     {summary.isLoading?<SkeletonCards/>:<div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{numbers.map(([label,value,color,Icon])=><div key={label} className="rounded-2xl border border-[#293638] bg-[#171f22] p-4 md:p-5"><div className="flex items-center justify-between"><span className="text-xs text-[#94a2a2]">{label}</span><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#263133]"><Icon className="h-4 w-4" style={{color}}/></span></div><p className="mt-4 font-mono text-2xl font-bold tracking-tight">{value??'—'}</p><p className="mt-1 text-[10px] text-[#758485]">{rtl?'حسب بيانات المتجر':'Live store data'}</p></div>)}</div>}
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-6"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">{t.activity}</h2><p className="mt-1 text-xs text-[#7f8e8f]">{rtl?'ما يحدث في متجرك':'What’s happening in your shop'}</p></div><Activity className="h-4 w-4 text-[#67d7ae]"/></div>
        {events.isLoading?<div className="mt-6 space-y-4"><SkeletonLine/><SkeletonLine/><SkeletonLine/></div>:events.isError?<ErrorPanel message={t.serverError} onRetry={()=>void events.refetch()}/>:events.data?.length?<div className="mt-5 divide-y divide-[#283437]">{events.data.map((event)=> <div key={event.id} className="flex gap-3 py-4 first:pt-0 last:pb-0"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#63d5a8]"/><div className="min-w-0 flex-1"><p className="text-sm text-[#d6dfdd]">{event.summary}</p><p className="mt-1 text-[10px] text-[#7e8d8e]">{event.action} · {new Date(event.createdAt).toLocaleString(rtl?'ar':'en',{dateStyle:'medium',timeStyle:'short'})}</p></div><ArrowUpRight className="h-4 w-4 shrink-0 text-[#657574]"/></div>)}</div>:<p className="mt-8 rounded-xl bg-[#1b2527] px-4 py-6 text-center text-xs text-[#859394]">{t.noActivity}</p>}
      </section>
      <section className="rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-6"><h2 className="text-sm font-semibold">{t.quick}</h2><p className="mt-1 text-xs text-[#7f8e8f]">{rtl?'تابع عملك دون مغادرة اللوحة':'Keep your momentum going'}</p><div className="mt-5 space-y-2">
        <ActionTile icon={Plus} title={t.addProduct} subtitle={rtl?'أضف عنصراً إلى كتالوجك':'Add an item to your catalog'} onClick={()=>navigate('/dashboard/products?new=1')}/>
        <ActionTile icon={MessageCircle} title={t.connect} subtitle={rtl?'انشر الكتالوج عبر Telegram':'Publish your catalog through Telegram'} onClick={()=>navigate('/dashboard/telegram')}/>
        <ActionTile icon={Boxes} title={t.manage} subtitle={rtl?'راجع المنتجات والمخزون':'Review inventory and details'} onClick={()=>navigate('/dashboard/products')}/>
      </div><div className="mt-5 rounded-xl border border-[#303d3d] bg-[#1b2526] p-4"><p className="text-[10px] uppercase tracking-wider text-[#8a9999]">{rtl?'تكامل البوت':'Bot integration'}</p><p className="mt-2 text-sm font-semibold">{bot.data?.connected?t.connected:t.disconnected}</p><p className="mt-1 text-[10px] text-[#758485]">{rtl?'لا يستقبل LootBot الدفعات؛ المبلغ المعروض هو ما سجّل المتجر استلامه يدويًا.':'LootBot does not collect payments; this is the amount the store marked as received manually.'}</p></div></section>
    </div>
  </div>;
}
function useGetCurrentUserName(){const {data}=useGetCurrentUser();return data?.name||'';}

function OrdersPage({store,locale='ar',t=copy.ar}:{store?:Store;locale?:Locale;t?:typeof copy.ar}) {
  const rtl=locale==='ar';
  const storeId=store?.id||'';
  const [page,setPage]=useState(1);
  const [status,setStatus]=useState<Order['status']|''>('');
  const [error,setError]=useState('');
  const qc=useQueryClient();
  const csrf=useGetCsrfToken();
  const request={request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}};
  const update=useUpdateOrderStatus(request);
  const paymentUpdate=useUpdateOrderPayment(request);
  const updating=update.isPending||paymentUpdate.isPending;
  const params={storeId,page,pageSize:25 as const,status:status||undefined};
  const plan=useQuery({queryKey:['store-plan',storeId],enabled:!!storeId,queryFn:async()=>{const response=await fetch(`/api/stores/${encodeURIComponent(storeId)}/plan`,{credentials:'include'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json() as Promise<{features:Record<string,boolean>}>;}});
  const orders=useListOrders(params,{query:{enabled:!!storeId,queryKey:getListOrdersQueryKey(params)}});
  const refreshOrders=()=>{
    void qc.invalidateQueries({queryKey:getListOrdersQueryKey()});
    void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})});
    void qc.invalidateQueries({queryKey:getGetDashboardActivityQueryKey({storeId,limit:8})});
    void qc.invalidateQueries({queryKey:getListProductsQueryKey()});
  };
  const changeStatus=(orderId:string,nextStatus:Order['status'])=>{
    if(nextStatus==='cancelled'&&!window.confirm(t.cancelOrderConfirm))return;
    setError('');
    update.mutate({orderId,data:{status:nextStatus}},{onSuccess:refreshOrders,onError:(e)=>setError(e.message)});
  };
  const changePayment=(orderId:string,nextStatus:'paid'|'refunded')=>{
    const confirmation=nextStatus==='paid'?t.markPaidConfirm:t.markRefundedConfirm;
    if(!window.confirm(confirmation))return;
    setError('');
    paymentUpdate.mutate({orderId,data:{status:nextStatus}},{onSuccess:refreshOrders,onError:(e)=>setError(e.message)});
  };
  return <section className="fade-up">
    <PageHeading eyebrow={store?.name||t.store} title={t.orders} subtitle={t.orderFlowNote}/>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="text-xs text-[#91a09f]">{rtl?'تصفية الطلبات':'Filter orders'}
        <select value={status} onChange={e=>{setStatus(e.target.value as Order['status']|'');setPage(1);}} className="ms-3 h-10 rounded-xl border border-[#2f3c3e] bg-[#171f22] px-3 text-sm text-[#e6edec]">
          <option value="">{t.allOrders}</option>
          <option value="pending">{t.orderPending}</option><option value="confirmed">{t.orderConfirmed}</option>
          <option value="fulfilled">{t.orderFulfilled}</option><option value="cancelled">{t.orderCancelled}</option>
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3"><p className="text-xs text-[#829091]">{orders.data?`${orders.data.total} ${rtl?'طلب':'orders'}`:''}</p>{plan.data?.features['analytics.reports']&&<a href={`/api/stores/${encodeURIComponent(storeId)}/reports/orders.csv`} className="rounded-lg border border-[#2e5a49] px-3 py-2 text-xs text-[#85e1bd]">{rtl?'تنزيل تقرير CSV':'Download CSV report'}</a>}</div>
    </div>
    {error&&<InlineError message={error}/>}
    {orders.isLoading?<SkeletonRows/>:orders.isError?<ErrorPanel message={t.serverError} onRetry={()=>void orders.refetch()}/>:
      orders.data?.items.length ? <div className="space-y-3">
        {orders.data.items.map(order=><article key={order.id} className="rounded-2xl border border-[#293638] bg-[#171f22] p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#20382f] text-[#71dcb4]"><ShoppingBag className="h-5 w-5"/></div>
              <div><p className="font-mono text-xs text-[#92a2a1]">#{order.id.slice(0,8)}</p><p className="mt-1 text-sm font-semibold">{order.telegramUsername?`@${order.telegramUsername}`:order.customerName}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{new Intl.NumberFormat(rtl?'ar-SA':'en',{style:'currency',currency:order.currency}).format(order.total)}</span><OrderStatusPill status={order.status} locale={locale}/><PaymentStatusPill status={order.paymentStatus} locale={locale} t={t}/></div>
          </div>
          <div className="mt-4 grid gap-3 border-t border-[#2a3738] pt-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">{order.items.map((item,index)=><p key={`${order.id}-${index}`} className="text-xs text-[#9eacab]">{item.productName} × {item.quantity}</p>)}
              <p className="pt-1 text-[10px] text-[#738283]">{new Date(order.createdAt).toLocaleString(rtl?'ar-SA':'en',{dateStyle:'medium',timeStyle:'short'})}{order.paymentUpdatedAt&&<> · {t.paymentUpdatedAt}: {new Date(order.paymentUpdatedAt).toLocaleString(rtl?'ar-SA':'en',{dateStyle:'medium',timeStyle:'short'})}</>}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {order.status==='pending'&&<button disabled={updating} onClick={()=>changeStatus(order.id,'confirmed')} className="rounded-lg bg-[#244235] px-3 py-2 text-xs font-semibold text-[#85e1bd] disabled:opacity-50">{t.confirmOrder}</button>}
              {order.status==='confirmed'&&<button disabled={updating} onClick={()=>changeStatus(order.id,'fulfilled')} className="rounded-lg bg-[#244235] px-3 py-2 text-xs font-semibold text-[#85e1bd] disabled:opacity-50">{t.fulfillOrder}</button>}
              {(order.status==='confirmed'||order.status==='fulfilled')&&order.paymentStatus==='unpaid'&&<button disabled={updating} onClick={()=>changePayment(order.id,'paid')} className="rounded-lg border border-[#2e5a49] px-3 py-2 text-xs text-[#85e1bd] disabled:opacity-50">{t.markPaid}</button>}
              {(order.status==='confirmed'||order.status==='fulfilled')&&order.paymentStatus==='paid'&&<button disabled={updating} onClick={()=>changePayment(order.id,'refunded')} className="rounded-lg border border-[#594b37] px-3 py-2 text-xs text-[#e0b87d] disabled:opacity-50">{t.markRefunded}</button>}
              {(order.status==='pending'||order.status==='confirmed')&&order.paymentStatus!=='paid'&&<button disabled={updating} onClick={()=>changeStatus(order.id,'cancelled')} className="rounded-lg border border-[#593b3c] px-3 py-2 text-xs text-[#e39b96] disabled:opacity-50">{t.cancelOrder}</button>}
            </div>
          </div>
        </article>)}
        <div className="flex items-center justify-between pt-2">
          <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border border-[#303d3f] px-3 py-2 text-xs disabled:opacity-40">{t.previous}</button>
          <span className="text-xs text-[#829091]">{page}</span>
          <button disabled={!orders.data||page*25>=orders.data.total} onClick={()=>setPage(p=>p+1)} className="rounded-lg border border-[#303d3f] px-3 py-2 text-xs disabled:opacity-40">{t.next}</button>
        </div>
      </div>:<EmptyPanel title={t.noOrders} detail={t.orderFlowNote}/>}
  </section>;
}

function StoresPage({locale='ar',t=copy.ar}:{locale?:Locale;t?:typeof copy.ar}) {
  const rtl=locale==='ar'; const query=useListStores(); const csrf=useGetCsrfToken(); const request={request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}}; const create=useCreateStore(request); const update=useUpdateStore(request); const remove=useDeleteStore(request); const qc=useQueryClient();
  const [editor,setEditor]=useState<Store|null|false>(false);const [error,setError]=useState('');
  const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const fd=new FormData(e.currentTarget);const data={name:String(fd.get('name')),currency:String(fd.get('currency'))};
    const done=()=>{void qc.invalidateQueries({queryKey:getListStoresQueryKey()});setEditor(false);};
    if(typeof editor==='object'&&editor!==null) update.mutate({storeId:editor.id,data},{onSuccess:done,onError:e=>setError(e.message)});
    else create.mutate({data},{onSuccess:done,onError:e=>setError(e.message)});
  };
  const deleteStore=(id:string)=>{if(!window.confirm(t.confirmDelete))return;remove.mutate({storeId:id},{onSuccess:()=>void qc.invalidateQueries({queryKey:getListStoresQueryKey()}),onError:e=>setError(e.message)});};
  return <section className="fade-up"><PageHeading eyebrow={t.workspace} title={t.stores} subtitle={t.storesSub} action={t.create} onAction={()=>setEditor(null)}/>
    {error&&<InlineError message={error}/>}
    {query.isLoading?<SkeletonRows/>:query.isError?<ErrorPanel message={t.serverError} onRetry={()=>void query.refetch()}/>:query.data?.length?<div className="space-y-3">{query.data.map(s=><article key={s.id} className="flex flex-col gap-4 rounded-2xl border border-[#293638] bg-[#171f22] p-5 sm:flex-row sm:items-center"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#20382f] text-[#71dcb4]"><StoreIcon className="h-5 w-5"/></div><div className="min-w-0 flex-1"><h3 className="font-semibold">{s.name}</h3><p className="mt-1 text-xs text-[#829091]">{s.slug} · {s.currency}</p></div><StatusPill value={s.botStatus}/><div className="flex gap-2"><button onClick={()=>setEditor(s)} className="rounded-lg border border-[#334142] px-3 py-2 text-xs hover:bg-[#243033]">{t.edit}</button><button onClick={()=>deleteStore(s.id)} className="rounded-lg border border-[#503838] p-2 text-[#d98d88] hover:bg-[#3b2626]" aria-label={t.delete}><Trash2 className="h-4 w-4"/></button></div></article>)}</div>:<EmptyPanel title={t.noStores} detail={t.storesSub} action={t.create} onAction={()=>setEditor(null)}/>}
    {editor!==false&&<Modal title={editor?t.edit:t.create} onClose={()=>setEditor(false)}><form onSubmit={save} className="space-y-4"><Field label={t.storeName} name="name" required defaultValue={editor?.name}/><CurrencySelect label={t.currency} defaultValue={editor?.currency}/><p className="text-xs text-[#819090]">{t.currencyHint}</p><ModalActions pending={create.isPending||update.isPending} onCancel={()=>setEditor(false)} t={t}/></form></Modal>}
  </section>;
}

function ProductsPage({store,locale='ar',t=copy.ar}:{store?:Store;locale?:Locale;t?:typeof copy.ar}) {
  const rtl=locale==='ar';const storeId=store?.id||'';const [search,setSearch]=useState('');const [page,setPage]=useState(1);const [editor,setEditor]=useState<ProductRecord|null|false>(false);const [error,setError]=useState('');const [selectedIds,setSelectedIds]=useState<string[]>([]);const [bulkPending,setBulkPending]=useState(false);const [galleryProduct,setGalleryProduct]=useState<ProductRecord|null>(null);
  const csrf=useGetCsrfToken();const request={request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}};
  const plan=useQuery({queryKey:['store-plan',storeId],enabled:!!storeId,queryFn:async()=>{const response=await fetch(`/api/stores/${encodeURIComponent(storeId)}/plan`,{credentials:'include'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json() as Promise<{plan:string;features:Record<string,boolean>}>;}});
  const params={storeId,page,pageSize:10 as const,search:search||undefined};
  const products=useListProducts(params,{query:{enabled:!!storeId,queryKey:getListProductsQueryKey(params)}});
  const cats=useListCategories({storeId,page:1,pageSize:100},{query:{enabled:!!storeId,queryKey:getListCategoriesQueryKey({storeId,page:1,pageSize:100})}});
  const create=useCreateProduct(request);const update=useUpdateProduct(request);const remove=useDeleteProduct(request);const qc=useQueryClient();
  const items=products.data?.items||[];
  const bulkTools=plan.data?.features['catalog.bulkTools']===true;
  const changeSelectedProducts=async(action:'publish'|'draft')=>{if(!csrf.data?.token||selectedIds.length===0)return;setBulkPending(true);setError('');try{const response=await fetch(`/api/stores/${encodeURIComponent(storeId)}/products/bulk`,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json','x-csrf-token':csrf.data.token},body:JSON.stringify({productIds:selectedIds,action})});const payload=await response.json().catch(()=>null) as {error?:string}|null;if(!response.ok)throw new Error(payload?.error||(rtl?'تعذر تحديث المنتجات المحددة.':'Could not update selected products.'));setSelectedIds([]);await qc.invalidateQueries({queryKey:getListProductsQueryKey()});}catch(cause){setError(cause instanceof Error?cause.message:(rtl?'تعذر تحديث المنتجات المحددة.':'Could not update selected products.'));}finally{setBulkPending(false);}};
  const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const fd=new FormData(e.currentTarget);const data:ProductInput={name:String(fd.get('name')),description:String(fd.get('description')),price:Number(fd.get('price')),stock:Number(fd.get('stock')),sku:String(fd.get('sku'))||null,categoryId:String(fd.get('categoryId'))||null,imageUrl:String(fd.get('imageUrl'))||null,isPublished:fd.get('isPublished')==='on'};
    const done=()=>{void qc.invalidateQueries({queryKey:getListProductsQueryKey()});void qc.invalidateQueries({queryKey:getListCategoriesQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})});setEditor(false);};
    if(typeof editor==='object'&&editor!==null)update.mutate({productId:editor.id,data},{onSuccess:done,onError:e=>setError(e.message)});
    else create.mutate({storeId,data},{onSuccess:done,onError:e=>setError(e.message)});
  };
  const deleteProduct=(id:string)=>{if(!window.confirm(t.confirmDelete))return;remove.mutate({productId:id},{onSuccess:()=>{void qc.invalidateQueries({queryKey:getListProductsQueryKey()});void qc.invalidateQueries({queryKey:getListCategoriesQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})});},onError:e=>setError(e.message)});};
  return <section className="fade-up"><PageHeading eyebrow={store?.name||t.store} title={t.products} subtitle={rtl?'كتالوج المنتجات المتاح لعملائك.':'The catalog your customers can browse.'} action={t.new} onAction={()=>setEditor(null)}/>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="absolute start-3 top-3 h-4 w-4 text-[#718181]"/><input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelectedIds([]);}} placeholder={t.search} className="h-10 w-full rounded-xl border border-[#2f3c3e] bg-[#171f22] ps-10 pe-3 text-sm outline-none focus:border-[#61d5a9]" data-testid="input-product-search"/></div><p className="text-xs text-[#829091]">{products.data ? products.data.total + ' ' + (rtl ? 'منتج' : 'products') : ''}</p></div>
    {plan.data&&!bulkTools&&<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#354344] bg-[#171f22] p-4 text-xs"><span className="text-[#aab6b5]">{rtl?'التحديث الجماعي للمنتجات متاح في Pro وBusiness.':'Bulk product updates are available on Pro and Business.'}</span><button disabled className="rounded-lg border border-[#354344] px-3 py-2 text-[#9ca9a8] disabled:opacity-60">{rtl?'الترقية قريبًا':'Upgrade soon'}</button></div>}
    {bulkTools&&items.length>0&&<div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#293638] bg-[#171f22] p-3"><span className="me-auto text-xs text-[#aab6b5]">{rtl?`تم تحديد ${selectedIds.length}`:`${selectedIds.length} selected`}</span><button disabled={!selectedIds.length||bulkPending} onClick={()=>void changeSelectedProducts('publish')} className="rounded-lg border border-[#2e5a49] px-3 py-2 text-xs text-[#85e1bd] disabled:opacity-40">{rtl?'نشر المحدد':'Publish selected'}</button><button disabled={!selectedIds.length||bulkPending} onClick={()=>void changeSelectedProducts('draft')} className="rounded-lg border border-[#594b37] px-3 py-2 text-xs text-[#e0b87d] disabled:opacity-40">{rtl?'تحويل لمسودة':'Move to draft'}</button></div>}
    {error&&<InlineError message={error}/>}
    {products.isLoading?<SkeletonRows/>:products.isError?<ErrorPanel message={t.serverError} onRetry={()=>void products.refetch()}/>:items.length?<><div className="overflow-x-auto rounded-2xl border border-[#293638]"><table className="w-full min-w-[740px] text-start text-sm"><thead className="bg-[#1b2527] text-[10px] uppercase tracking-wide text-[#899898]"><tr>{bulkTools&&<th className="px-3 py-3"><input aria-label={rtl?'تحديد منتجات الصفحة':'Select page products'} type="checkbox" checked={items.length>0&&items.every(item=>selectedIds.includes(item.id))} onChange={event=>setSelectedIds(event.target.checked?Array.from(new Set([...selectedIds,...items.map(item=>item.id)])):selectedIds.filter(id=>!items.some(item=>item.id===id)))} className="accent-[#62d6aa]"/></th>}{[t.name,t.category,t.price,t.stock,'',t.actions].map((h,i)=><th className="px-4 py-3 text-start font-medium" key={h+i}>{h}</th>)}</tr></thead><tbody className="divide-y divide-[#293638]">{items.map(p=><tr key={p.id} className="bg-[#171f22] hover:bg-[#1b2527]" data-testid={`row-product-${p.id}`}>{bulkTools&&<td className="px-3 py-4"><input aria-label={`${rtl?'تحديد':'Select'} ${p.name}`} type="checkbox" checked={selectedIds.includes(p.id)} onChange={event=>setSelectedIds(current=>event.target.checked?[...current,p.id]:current.filter(id=>id!==p.id))} className="accent-[#62d6aa]"/></td>}<td className="px-4 py-4"><p className="font-medium text-[#dce5e3]">{p.name}</p><p className="mt-1 text-[10px] text-[#768585]">{p.sku||'—'}</p></td><td className="px-4 py-4 text-xs text-[#9aa8a7]">{p.categoryName||'—'}</td><td className="px-4 py-4 font-mono text-xs">{formatPrice(p.price,store?.currency||'USD',locale)}</td><td className="px-4 py-4 font-mono text-xs">{p.stock}</td><td className="px-4 py-4"><StatusPill value={p.isPublished?'published':'draft'}/></td><td className="px-4 py-4"><div className="flex gap-2"><button onClick={()=>setEditor(p)} className="text-xs text-[#85dabc] hover:underline">{t.edit}</button><button onClick={()=>setGalleryProduct(p)} className="text-xs text-[#85dabc] hover:underline">{rtl?'الصور':'Images'}</button><button onClick={()=>deleteProduct(p.id)} className="text-xs text-[#d88b85] hover:underline">{t.delete}</button></div></td></tr>)}</tbody></table></div><Pager page={page} pageSize={products.data?.pageSize||10} total={products.data?.total||0} setPage={pageNumber=>{setSelectedIds([]);setPage(pageNumber);}} t={t}/></>:<EmptyPanel title={search?(rtl?'لا توجد نتائج':'No matches found'):t.empty} detail={search?(rtl?'جرّب البحث بكلمات أخرى.':'Try another search term.'):rtl?'أضف منتجك الأول لبدء بناء الكتالوج.':'Add your first item to start building the catalog.'} action={!search?t.new:undefined} onAction={()=>setEditor(null)}/>}
    {galleryProduct&&<Modal title={`${rtl?'صور المنتج':'Product gallery'}: ${galleryProduct.name}`} onClose={()=>setGalleryProduct(null)} wide><ProductGallery key={galleryProduct.id} productId={galleryProduct.id} csrfToken={csrf.data?.token} locale={locale} onSaved={()=>void qc.invalidateQueries({queryKey:getListProductsQueryKey()})}/></Modal>}
    {editor!==false&&<Modal title={editor?t.edit:t.new} onClose={()=>setEditor(false)} wide><form onSubmit={save} className="grid gap-4 sm:grid-cols-2"><Field label={t.name} name="name" required defaultValue={editor?.name} className="sm:col-span-2"/><div className="sm:col-span-2"><label className="mb-2 block text-sm text-[#c4cecd]">{t.description}</label><textarea name="description" rows={3} defaultValue={editor?.description||''} className="w-full rounded-xl border border-[#354344] bg-[#182123] px-4 py-3 text-sm outline-none focus:border-[#62d6aa]" data-testid="input-description"/></div><Field label={t.price} name="price" type="number" min="0" step="0.01" required defaultValue={editor?.price}/><Field label={t.stock} name="stock" type="number" min="0" required defaultValue={editor?.stock??0}/><Field label={t.sku} name="sku" defaultValue={editor?.sku||''}/><div><label className="mb-2 block text-sm text-[#c4cecd]">{t.category}</label><select name="categoryId" defaultValue={editor?.categoryId||''} className="h-11 w-full rounded-xl border border-[#354344] bg-[#182123] px-3 text-sm outline-none focus:border-[#62d6aa]"><option value="">—</option>{cats.data?.items?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><Field label={rtl?'رابط الصورة':'Image URL'} name="imageUrl" type="url" defaultValue={editor?.imageUrl||''} className="sm:col-span-2"/><label className="flex items-center gap-2 text-sm text-[#c4cecd] sm:col-span-2"><input type="checkbox" name="isPublished" defaultChecked={editor?editor.isPublished:false} className="accent-[#62d6aa]"/> {t.publishedFlag}</label><div className="sm:col-span-2"><ModalActions pending={create.isPending||update.isPending} onCancel={()=>setEditor(false)} t={t}/></div></form></Modal>}
  </section>;
}
type ProductRecord={id:string;name:string;description:string;price:number;stock:number;sku:string|null;categoryId:string|null;imageUrl:string|null;isPublished:boolean};

function CategoriesPage({store,locale='ar',t=copy.ar}:{store?:Store;locale?:Locale;t?:typeof copy.ar}) {
  const storeId=store?.id||'';const [editor,setEditor]=useState<CategoryRecord|null|false>(false);const [error,setError]=useState('');
  const csrf=useGetCsrfToken();const request={request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}};
  const params={storeId,page:1,pageSize:100 as const};const cats=useListCategories(params,{query:{enabled:!!storeId,queryKey:getListCategoriesQueryKey(params)}});
  const create=useCreateCategory(request);const update=useUpdateCategory(request);const remove=useDeleteCategory(request);const qc=useQueryClient();
  const finish=()=>{void qc.invalidateQueries({queryKey:getListCategoriesQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})});setEditor(false);};
  const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const fd=new FormData(e.currentTarget);const data={name:String(fd.get('name')),description:String(fd.get('description'))||undefined};if(typeof editor==='object'&&editor!==null)update.mutate({categoryId:editor.id,data},{onSuccess:finish,onError:e=>setError(e.message)});else create.mutate({storeId,data},{onSuccess:finish,onError:e=>setError(e.message)});};
  const del=(id:string)=>{if(!window.confirm(t.confirmDelete))return;remove.mutate({categoryId:id},{onSuccess:finish,onError:e=>setError(e.message)});};
  return <section className="fade-up"><PageHeading eyebrow={store?.name||t.store} title={t.categories} subtitle={t.categoriesTotal} action={t.new} onAction={()=>setEditor(null)}/>{error&&<InlineError message={error}/>}
    {cats.isLoading?<SkeletonRows/>:cats.isError?<ErrorPanel message={t.serverError} onRetry={()=>void cats.refetch()}/>:cats.data?.items.length?<div className="grid gap-3 md:grid-cols-2">{cats.data.items.map(c=><article key={c.id} className="rounded-2xl border border-[#293638] bg-[#171f22] p-5"><div className="flex items-start justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#263138] text-[#92b2dc]"><Tag className="h-5 w-5"/></div><div className="flex gap-2"><button onClick={()=>setEditor(c)} className="rounded-lg border border-[#334142] px-3 py-2 text-xs hover:bg-[#243033]">{t.edit}</button><button onClick={()=>del(c.id)} aria-label={t.delete} className="rounded-lg border border-[#503838] p-2 text-[#d98d88] hover:bg-[#3b2626]"><Trash2 className="h-4 w-4"/></button></div></div><h3 className="mt-4 font-semibold">{c.name}</h3><p className="mt-1 min-h-5 text-xs text-[#879595]">{c.description||'—'}</p><p className="mt-5 border-t border-[#2b3839] pt-3 text-xs text-[#8a9999]">{c.productCount} {t.products.toLowerCase()}</p></article>)}</div>:<EmptyPanel title={t.empty} detail={locale==='ar'?'أنشئ تصنيفاً لتنظيم منتجاتك.':'Create categories to organize your products.'} action={t.new} onAction={()=>setEditor(null)}/>}
    {editor!==false&&<Modal title={editor?t.edit:t.new} onClose={()=>setEditor(false)}><form onSubmit={save} className="space-y-4"><Field label={t.name} name="name" required defaultValue={editor?.name}/><div><label className="mb-2 block text-sm text-[#c4cecd]">{t.description}</label><textarea name="description" rows={4} defaultValue={editor?.description||''} className="w-full rounded-xl border border-[#354344] bg-[#182123] px-4 py-3 text-sm outline-none focus:border-[#62d6aa]"/></div><ModalActions pending={create.isPending||update.isPending} onCancel={()=>setEditor(false)} t={t}/></form></Modal>}
  </section>;
}
type CategoryRecord={id:string;name:string;description:string|null;productCount:number};

function TelegramPage({store,locale='ar',t=copy.ar}:{store?:Store;locale?:Locale;t?:typeof copy.ar}) {
  const storeId=store?.id||'';const bot=useGetStoreBot(storeId,{query:{enabled:!!storeId,queryKey:getGetStoreBotQueryKey(storeId)}});const csrf=useGetCsrfToken();const request={request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}};const connect=useConnectStoreBot(request);const disconnect=useDisconnectStoreBot(request);const qc=useQueryClient();const [token,setToken]=useState('');const [error,setError]=useState('');
  const invalidate=()=>{void qc.invalidateQueries({queryKey:getGetStoreBotQueryKey(storeId)});void qc.invalidateQueries({queryKey:getListStoresQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})});};
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');connect.mutate({storeId,data:{token}},{onSuccess:()=>{setToken('');invalidate();},onError:e=>setError(e.message)});};
  const designer=useQuery({queryKey:['telegram-designer',storeId],enabled:!!storeId,queryFn:async()=>{const response=await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/designer`,{credentials:'include'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json() as Promise<{enabled:boolean;requiredPlan:'PRO';settings:{welcomeMessage:string;helpMessage:string;catalogIntro:string;showStock:boolean}}>}});
  const [designerDraft,setDesignerDraft]=useState({welcomeMessage:'',helpMessage:'',catalogIntro:'',showStock:true});const [designerError,setDesignerError]=useState('');const [designerSaved,setDesignerSaved]=useState(false);
  useEffect(()=>{if(designer.data)setDesignerDraft(designer.data.settings);},[designer.data]);
  const saveDesigner=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setDesignerError('');setDesignerSaved(false);if(!csrf.data?.token)return;try{const response=await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/designer`,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json','x-csrf-token':csrf.data.token},body:JSON.stringify(designerDraft)});const payload=await response.json().catch(()=>null) as {error?:string;settings?:typeof designerDraft}|null;if(!response.ok)throw new Error(payload?.error||(locale==='ar'?'تعذر حفظ تخصيص البوت.':'Could not save bot customization.'));if(payload?.settings)setDesignerDraft(payload.settings);setDesignerSaved(true);await designer.refetch();}catch(cause){setDesignerError(cause instanceof Error?cause.message:(locale==='ar'?'تعذر حفظ تخصيص البوت.':'Could not save bot customization.'));}};
  return <section className="fade-up"><PageHeading eyebrow={store?.name||t.store} title={t.telegram} subtitle={t.botHelp}/><div className="grid gap-5 xl:grid-cols-[1fr_.8fr]">
    <div className="rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7"><div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1e3c4a] text-[#68bbdc]"><MessageCircle className="h-6 w-6"/></div><div><h2 className="font-semibold">Telegram Bot</h2><p className="mt-1 text-xs text-[#879595]">{locale==='ar'?'إدارة اتصال متجرك':'Manage your store connection'}</p></div><div className="ms-auto">{bot.isLoading?<span className="h-5 w-16 animate-pulse rounded-full bg-[#2b383a]"/>:<StatusPill value={bot.data?.status||'disconnected'}/>}</div></div>
      {bot.isError&&<ErrorPanel message={t.serverError} onRetry={()=>void bot.refetch()}/>}
      {bot.data?.connected?<div className="mt-7"><div className="rounded-xl border border-[#2d4c3e] bg-[#1b3029] p-4"><p className="text-[10px] uppercase tracking-wider text-[#85bba4]">{t.connected}</p><p className="mt-2 text-lg font-semibold text-[#d7e8e0]">{bot.data.firstName||bot.data.username||'Telegram bot'}</p>{bot.data.username&&<p className="mt-1 text-xs text-[#8ab6a4]">@{bot.data.username}</p>}</div><button onClick={()=>disconnect.mutate({storeId},{onSuccess:invalidate,onError:e=>setError(e.message)})} disabled={disconnect.isPending} className="mt-5 rounded-xl border border-[#694141] px-4 py-2.5 text-sm text-[#e4a09a] hover:bg-[#3a2525] disabled:opacity-50">{disconnect.isPending?'…':t.disconnect}</button></div>:
      <form onSubmit={submit} className="mt-7"><label className="mb-2 block text-sm text-[#c4cecd]">{t.botToken}</label><input value={token} onChange={e=>setToken(e.target.value)} minLength={20} maxLength={256} required type="password" autoComplete="off" placeholder="123456789:AA..." className="h-12 w-full rounded-xl border border-[#354344] bg-[#182123] px-4 font-mono text-sm outline-none focus:border-[#62d6aa]" data-testid="input-bot-token"/><p className="mt-2 text-xs leading-5 text-[#819090]">{locale==='ar'?'أنشئ بوتاً عبر @BotFather ثم ألصق الرمز هنا. يتم حفظ الرمز بأمان.':'Create a bot with @BotFather, then paste its token here. Your token is stored securely.'}</p>{error&&<InlineError message={error}/>}<button disabled={connect.isPending} className="mt-5 flex items-center gap-2 rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d] disabled:opacity-50">{connect.isPending?'…':t.connectBot}<ArrowLeft className="h-4 w-4"/></button></form>}
    </div>
    <aside className="rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7"><h3 className="font-semibold">{locale==='ar'?'قبل الربط':'Before you connect'}</h3><ol className="mt-5 space-y-5">{[locale==='ar'?'افتح @BotFather في Telegram.':'Open @BotFather in Telegram.',locale==='ar'?'أنشئ بوتاً جديداً وانسخ رمز API.':'Create a bot and copy its API token.',locale==='ar'?'ألصق الرمز أعلاه للربط.':'Paste your token above to connect.'].map((s,i)=><li key={s} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#263933] font-mono text-[10px] text-[#7ce0b9]">{i+1}</span><span className="pt-1 text-sm leading-6 text-[#a4b0af]">{s}</span></li>)}</ol><p className="mt-7 border-t border-[#2b3839] pt-4 text-[11px] leading-5 text-[#7f8d8d]"><ShieldCheck className="me-1 inline h-3.5 w-3.5 text-[#70d5ad]"/>{locale==='ar'?'لا تشارك رمز البوت مع أي شخص.':'Never share your bot token with anyone.'}</p></aside>
    <div className="rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7 xl:col-span-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{locale==='ar'?'تخصيص رسائل البوت':'Bot message designer'}</h2><p className="mt-1 text-xs text-[#879595]">{locale==='ar'?'رسائل مخصصة لبوت Telegram، مع دعم {{store}} و{{customer}}.':'Personalize Telegram replies. Use {{store}} and {{customer}} placeholders.'}</p></div>{designer.data?.enabled&&<span className="rounded-full bg-[#1b3029] px-3 py-1 text-xs text-[#85dabc]">{locale==='ar'?'متاح في Pro وBusiness':'Pro & Business'}</span>}</div>
      {designer.isLoading?<p className="mt-5 text-sm text-[#9aa8a8]">{locale==='ar'?'جار تحميل الإعدادات…':'Loading settings…'}</p>:designer.isError?<div className="mt-4"><ErrorPanel message={t.serverError} onRetry={()=>void designer.refetch()}/></div>:designer.data?.enabled===false?<p className="mt-5 rounded-xl border border-[#493d2c] bg-[#30271d] p-4 text-sm text-[#e5c996]">{locale==='ar'?'هذه الميزة متاحة في خطتي Pro وBusiness.':'This feature is available on Pro and Business plans.'}</p>:<form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={saveDesigner}>
        {([['welcomeMessage',locale==='ar'?'الترحيب الافتراضي (قبل نشر الرئيسية)':'Default welcome (before home publication)'],['helpMessage',locale==='ar'?'رسالة المساعدة':'Help message'],['catalogIntro',locale==='ar'?'مقدمة الكتالوج':'Catalog introduction']] as const).map(([field,label])=><label key={field} className="block text-sm text-[#c4cecd]">{label}<textarea value={designerDraft[field]} onChange={e=>{setDesignerDraft({...designerDraft,[field]:e.target.value});setDesignerSaved(false);}} maxLength={400} rows={3} placeholder={field==='welcomeMessage'?'مرحباً {{customer}} في {{store}}':field==='helpMessage'?'استخدم /catalog لعرض المنتجات':'كتالوج {{store}}'} className="mt-2 w-full resize-y rounded-xl border border-[#354344] bg-[#182123] p-3 text-sm outline-none focus:border-[#62d6aa]"/><span className="mt-1 block text-[10px] text-[#758485]">{designerDraft[field].length}/400</span></label>)}
        <label className="flex items-center gap-3 self-start rounded-xl border border-[#2b3839] p-4 text-sm text-[#c4cecd]"><input type="checkbox" checked={designerDraft.showStock} onChange={e=>setDesignerDraft({...designerDraft,showStock:e.target.checked})} className="accent-[#62d6aa]"/>{locale==='ar'?'إظهار المخزون المتاح في الكتالوج':'Show available stock in catalog'}</label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">{designerError&&<InlineError message={designerError} />}{designerSaved&&<span className="text-sm text-[#80d7b5]">{locale==='ar'?'تم حفظ الإعدادات':'Settings saved'}</span>}<button disabled={!csrf.data?.token||designer.isFetching} className="ms-auto rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d] disabled:opacity-50">{locale==='ar'?'حفظ التخصيص':'Save customization'}</button></div>
      </form>}
    </div>
  </div><TelegramHealth storeId={storeId} csrfToken={csrf.data?.token} locale={locale}/><TelegramHomeStudio storeId={storeId} csrfToken={csrf.data?.token} locale={locale}/><BusinessBotStudio storeId={storeId} csrfToken={csrf.data?.token} locale={locale}/></section>;
}

function SettingsPage({store,locale='ar',t=copy.ar}:{store?:Store;locale?:Locale;t?:typeof copy.ar}) {
  const csrf=useGetCsrfToken();const update=useUpdateStore({request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}});const qc=useQueryClient();const [saved,setSaved]=useState(false);const [error,setError]=useState('');const plan=useQuery({queryKey:['store-plan',store?.id],enabled:!!store,queryFn:async()=>{const response=await fetch(`/api/stores/${encodeURIComponent(store!.id)}/plan`,{credentials:'include'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json() as Promise<{planName:string;plan:string;limits:{stores:number;productsPerStore:number;categoriesPerStore:number;ordersPerMonth:number};usage:{stores:number;productsPerStore:number;categoriesPerStore:number;ordersPerMonth:number}}>;}});
  if(!store)return <EmptyPanel title={t.noStores} detail={t.storesSub}/>;
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');setSaved(false);const fd=new FormData(e.currentTarget);update.mutate({storeId:store.id,data:{name:String(fd.get('name')),currency:String(fd.get('currency'))}},{onSuccess:()=>{setSaved(true);void qc.invalidateQueries({queryKey:getListStoresQueryKey()});void qc.invalidateQueries({queryKey:getGetCurrentUserQueryKey()});},onError:e=>setError(e.message)});};
  return <section className="fade-up max-w-3xl"><PageHeading eyebrow={store.name} title={t.settingsTitle} subtitle={t.settingsSub}/><div className="mb-5 rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs text-[#8b9a99]">{locale==='ar'?'الباقة والاستخدام':'Plan and usage'}</p><h2 className="mt-2 text-xl font-semibold">{plan.data?.planName ?? (plan.isLoading?'…':'—')}</h2><p className="mt-2 text-xs text-[#839190]">{locale==='ar'?'الباقات المدفوعة غير مفعلة للتحصيل بعد. ستتوفر الترقية قريبًا.':'Paid plans are not accepting payments yet. Upgrades will be available soon.'}</p></div><button disabled className="rounded-xl border border-[#354344] px-4 py-2 text-xs text-[#9ca9a8] disabled:opacity-60">{locale==='ar'?'الترقية قريبًا':'Upgrade soon'}</button></div>{plan.isError?<ErrorPanel message={locale==='ar'?'تعذر تحميل استخدام الباقة.':'Could not load plan usage.'} onRetry={()=>void plan.refetch()}/>:plan.data&&<div className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{([['productsPerStore',locale==='ar'?'المنتجات':'Products'],['categoriesPerStore',locale==='ar'?'التصنيفات':'Categories'],['ordersPerMonth',locale==='ar'?'الطلبات هذا الشهر':'Orders this month'],['stores',locale==='ar'?'المتاجر':'Stores']] as const).map(([key,label])=><div key={key} className="rounded-xl bg-[#11191b] p-3"><p className="text-[#839190]">{label}</p><p className="mt-2 font-mono text-sm">{plan.data!.usage[key]} / {plan.data!.limits[key]}</p></div>)}</div>}</div><form onSubmit={submit} className="rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7"><div className="mb-6 flex items-center gap-3 border-b border-[#2a3739] pb-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#263630] text-[#71dcb4]"><Settings2 className="h-5 w-5"/></div><div><h2 className="text-sm font-semibold">{t.storeName}</h2><p className="mt-1 text-xs text-[#859292]">{locale==='ar'?'تظهر هذه المعلومات في واجهة متجرك.':'Shown in your storefront and shop details.'}</p></div></div><div className="space-y-5"><Field label={t.storeName} name="name" required defaultValue={store.name}/><div><CurrencySelect label={t.currency} defaultValue={store.currency}/><p className="mt-2 text-xs text-[#819090]">{t.currencyHint}</p></div></div>{error&&<InlineError message={error}/>} {saved&&<p className="mt-4 text-sm text-[#78dcb6]"><Check className="me-1 inline h-4 w-4"/>{locale==='ar'?'تم حفظ إعداداتك.':'Settings saved.'}</p>}<button disabled={update.isPending} className="mt-7 rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d] disabled:opacity-50">{update.isPending?'…':t.save}</button></form></section>;
}

function Onboarding() {
  const [locale,toggleLocale]=useLocale();const t=copy[locale];const rtl=locale==='ar';const user=useGetCurrentUser();const stores=useListStores();const csrf=useGetCsrfToken();const request={request:{headers:csrf.data?.token?{'x-csrf-token':csrf.data.token}:undefined}};const createStore=useCreateStore(request);const createProduct=useCreateProduct(request);const connect=useConnectStoreBot(request);const qc=useQueryClient();const [,navigate]=useLocation();
  const [step,setStep]=useState(0);const [error,setError]=useState('');const [created,setCreated]=useState<Store|null>(null);
  useEffect(()=>{if(step===0&&stores.data?.[0]){setCreated(stores.data[0]);setStep(3);}},[stores.data,step]);
  if(user.isLoading||stores.isLoading)return <LoadingScreen/>;
  if(user.isError||!user.data)return <AuthRequired locale={locale}/>;
  const submitStore=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const fd=new FormData(e.currentTarget);createStore.mutate({data:{name:String(fd.get('name')),currency:String(fd.get('currency'))}},{onSuccess:s=>{setCreated(s);setStep(1);void qc.invalidateQueries({queryKey:getListStoresQueryKey()});},onError:e=>setError(e.message)});};
  const connectBot=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!created)return;const fd=new FormData(e.currentTarget);connect.mutate({storeId:created.id,data:{token:String(fd.get('token'))}},{onSuccess:()=>{setStep(2);void qc.invalidateQueries({queryKey:getGetStoreBotQueryKey(created.id)});},onError:e=>setError(e.message)});};
  const submitProduct=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!created)return;const fd=new FormData(e.currentTarget);createProduct.mutate({storeId:created.id,data:{name:String(fd.get('name')),description:String(fd.get('description')),price:Number(fd.get('price')),stock:Number(fd.get('stock')),sku:null,categoryId:null,imageUrl:null,isPublished:true}},{onSuccess:()=>{void qc.invalidateQueries({queryKey:getListProductsQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId:created.id})});navigate('/dashboard');},onError:e=>setError(e.message)});};
  const proceed=()=>{if(step===3){navigate('/dashboard');return;}if(step===1){setStep(2);return;}if(step===2){setStep(3);return;}};
  return <main dir={rtl?'rtl':'ltr'} className="min-h-[100dvh] bg-[#11171c] px-5 py-6 text-[#e8efee]"><header className="mx-auto flex max-w-5xl items-center justify-between"><Link href="/" className="flex items-center gap-3"><BrandMark/><b>lootbot<span className="text-[#64d6ae]">.</span></b></Link><button onClick={toggleLocale} className="text-xs text-[#9aa8a8]" data-testid="button-language">{rtl?'EN':'العربية'}</button></header>
    <section className="mx-auto mt-14 max-w-[680px] fade-up"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[.15em] text-[#69d8b0]">{t.onboarding}</p><span className="text-xs text-[#819090]">{Math.min(step+1,4)} / 4</span></div><div className="mt-4 flex gap-2">{[0,1,2,3].map(i=><span key={i} className={`h-1 flex-1 rounded-full ${i<=step?'bg-[#64d6a9]':'bg-[#2b383a]'}`}/>)}</div><h1 className="mt-7 text-3xl font-semibold">{t.onboarding}</h1><p className="mt-2 text-sm leading-6 text-[#91a09f]">{t.onboardingSub}</p>
      <div className="mt-8 rounded-2xl border border-[#2d3a3c] bg-[#171f22] p-5 md:p-8">
        {step===0&&<form onSubmit={submitStore} className="space-y-5"><div className="rounded-xl bg-[#1e292a] p-4"><p className="text-xs text-[#819090]">{t.fullName}</p><p className="mt-1 text-sm font-semibold">{user.data.name}</p></div><Field label={t.storeName} name="name" required placeholder={rtl?'مثال: متجر لُمى':'e.g. Lumi Shop'}/><div><CurrencySelect label={t.currency} defaultValue="SAR"/><p className="mt-2 text-xs text-[#819090]">{t.currencyHint}</p></div><div className="flex justify-end"><button disabled={createStore.isPending||!csrf.data?.token} className="rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d]">{createStore.isPending?'…':t.continue}<ArrowLeft className="ms-2 inline h-4 w-4"/></button></div></form>}
        {step===1&&<div><div className="mb-5"><h2 className="font-semibold">{t.telegram}</h2><p className="mt-1 text-sm text-[#91a09f]">{t.botHelp}</p></div><form onSubmit={connectBot}><label className="mb-2 block text-sm text-[#c4cecd]">{t.botToken}</label><input type="password" name="token" minLength={20} maxLength={256} required className="h-12 w-full rounded-xl border border-[#354344] bg-[#182123] px-4 font-mono text-sm outline-none focus:border-[#62d6aa]" placeholder="123456789:AA..."/><div className="mt-5 flex items-center justify-between"><button type="button" onClick={()=>setStep(2)} className="text-xs text-[#91a09f] hover:text-white">{t.skip}</button><button disabled={connect.isPending||!csrf.data?.token} className="rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d]">{connect.isPending?'…':t.connectBot}</button></div></form><p className="mt-4 text-xs text-[#819090]">{t.connectLater}</p></div>}
        {step===2&&<form onSubmit={submitProduct} className="space-y-4"><h2 className="mb-4 font-semibold">{t.createFirstProduct}</h2><Field label={t.name} name="name" required/><Field label={t.description} name="description" required/><div className="grid grid-cols-2 gap-3"><Field label={t.price} name="price" type="number" step="0.01" min="0" required/><Field label={t.stock} name="stock" type="number" min="0" defaultValue="1" required/></div><div className="flex justify-end"><button disabled={createProduct.isPending||!csrf.data?.token} className="rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d]">{createProduct.isPending?'…':t.createFirstProduct}</button></div></form>}
        {step===3&&<div className="py-5 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#1f3b30] text-[#74dfb7]"><Check className="h-7 w-7"/></div><h2 className="mt-5 text-xl font-semibold">{rtl?'متجرك جاهز':'Your store is ready'}</h2><p className="mt-2 text-sm text-[#92a09f]">{created?.name}</p><div className="mt-6 flex justify-center"><button onClick={proceed} className="rounded-xl bg-[#62d6aa] px-6 py-3 text-sm font-bold text-[#10231d]">{t.dashboard}<ArrowLeft className="ms-2 inline h-4 w-4"/></button></div></div>}
        {error&&<InlineError message={error}/>}
      </div>
    </section>
  </main>;
}

function PageHeading({eyebrow,title,subtitle,action,onAction}:{eyebrow:string;title:string;subtitle:string;action?:string;onAction?:()=>void}) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-semibold uppercase tracking-[.17em] text-[#68d8af]">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-[#899797]">{subtitle}</p></div>{action&&onAction&&<button onClick={onAction} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-[#62d6aa] px-4 text-sm font-bold text-[#10231d] hover:bg-[#7be4bd] sm:self-auto" data-testid="button-create"><Plus className="h-4 w-4"/>{action}</button>}</div>;
}
function Field({label,name,type='text',required=false,defaultValue,placeholder,className='',...props}:{label:string;name:string;type?:string;required?:boolean;defaultValue?:string|number;placeholder?:string;className?:string;autoComplete?:string;min?:string;max?:string;step?:string}) {
  return <div className={className}><label className="mb-2 block text-sm text-[#c4cecd]" htmlFor={name}>{label}</label><input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} min={props.min} max={props.max} step={props.step} autoComplete={props.autoComplete} className="h-11 w-full rounded-xl border border-[#354344] bg-[#182123] px-4 text-sm text-[#e7eeec] outline-none placeholder:text-[#647273] transition focus:border-[#62d6aa] focus:ring-2 focus:ring-[#62d6aa]/10" data-testid={`input-${name}`}/></div>;
}
function CurrencySelect({label,defaultValue='USD'}:{label:string;defaultValue?:string}) {
  return <div><label className="mb-2 block text-sm text-[#c4cecd]" htmlFor="currency">{label}</label><select name="currency" id="currency" defaultValue={defaultValue} className="h-11 w-full rounded-xl border border-[#354344] bg-[#182123] px-3 text-sm outline-none focus:border-[#62d6aa]" data-testid="select-currency">{[['USD','US Dollar · USD'],['SAR','Saudi Riyal · SAR'],['AED','UAE Dirham · AED'],['EGP','Egyptian Pound · EGP'],['KWD','Kuwaiti Dinar · KWD'],['QAR','Qatari Riyal · QAR'],['BHD','Bahraini Dinar · BHD'],['OMR','Omani Rial · OMR'],['JOD','Jordanian Dinar · JOD'],['EUR','Euro · EUR'],['GBP','British Pound · GBP']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>;
}
function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-[#354344] bg-[#171f22] p-5 shadow-2xl sm:rounded-2xl sm:p-6 ${wide?'max-w-2xl':'max-w-lg'}`}><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[#8a9999] hover:bg-[#283436]"><X className="h-4 w-4"/></button></div>{children}</div></div>;
}
function ModalActions({pending,onCancel,t}:{pending:boolean;onCancel:()=>void;t:typeof copy.ar}) {
  return <div className="flex justify-end gap-2 border-t border-[#2b3839] pt-4"><button type="button" onClick={onCancel} className="rounded-xl border border-[#354344] px-4 py-2.5 text-sm text-[#acb8b7] hover:bg-[#253133]">{t.cancel}</button><button disabled={pending} className="rounded-xl bg-[#62d6aa] px-5 py-2.5 text-sm font-bold text-[#10231d] disabled:opacity-50">{pending?'…':t.save}</button></div>;
}
function StatusPill({value}:{value:string}) {
  const connected=['connected','published'].includes(value);
  const error=value==='error';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${connected?'bg-[#1e392f] text-[#7edcb7]':error?'bg-[#3d2928] text-[#e29b94]':'bg-[#292f30] text-[#a3adac]'}`}><span className={`h-1.5 w-1.5 rounded-full ${connected?'bg-[#69d9ae]':error?'bg-[#dc847c]':'bg-[#879191]'}`}/>{value==='published'?'Published':value==='draft'?'Draft':value}</span>;
}
function OrderStatusPill({status,locale}:{status:Order['status'];locale:Locale}) {
  const labels=locale==='ar'
    ?{pending:'قيد الانتظار',confirmed:'مؤكد',fulfilled:'مكتمل',cancelled:'ملغي'}
    :{pending:'Pending',confirmed:'Confirmed',fulfilled:'Fulfilled',cancelled:'Cancelled'};
  const colors={
    pending:'bg-[#3a3021] text-[#e2bd7d]',
    confirmed:'bg-[#203a32] text-[#81dbb6]',
    fulfilled:'bg-[#233449] text-[#9ec2e8]',
    cancelled:'bg-[#3d2928] text-[#e29b94]',
  };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${colors[status]}`}>{labels[status]}</span>;
}
function PaymentStatusPill({status,locale,t}:{status:Order['paymentStatus'];locale:Locale;t:typeof copy.ar}) {
  const label=status==='paid'?t.paymentPaid:status==='refunded'?t.paymentRefunded:t.paymentUnpaid;
  const color=status==='paid'
    ?'bg-[#203a32] text-[#81dbb6]'
    :status==='refunded'
      ?'bg-[#233449] text-[#9ec2e8]'
      :'bg-[#292f30] text-[#a3adac]';
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${color}`}>{label}</span>;
}
function ActionTile({icon:Icon,title,subtitle,onClick}:{icon:typeof Plus;title:string;subtitle:string;onClick:()=>void}) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-[#2a3739] bg-[#1b2527] p-3 text-start transition hover:border-[#416457] hover:bg-[#202d2c]"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#263a33] text-[#70d9b2]"><Icon className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{title}</span><span className="mt-1 block text-[10px] text-[#829091]">{subtitle}</span></span><ArrowLeft className="h-4 w-4 text-[#758485]"/></button>;
}
function EmptyPanel({title,detail,action,onAction}:{title:string;detail:string;action?:string;onAction?:()=>void}) {
  return <div className="rounded-2xl border border-dashed border-[#354344] bg-[#171f22] px-5 py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#263432] text-[#70d9b2]"><Package className="h-5 w-5"/></span><h2 className="mt-4 text-base font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm text-[#899797]">{detail}</p>{action&&onAction&&<button onClick={onAction} className="mt-5 rounded-xl bg-[#62d6aa] px-4 py-2.5 text-sm font-bold text-[#10231d]">{action}</button>}</div>;
}
function ErrorPanel({message,onRetry}:{message:string;onRetry:()=>void}) {
  return <div role="alert" className="my-4 flex items-center justify-between gap-4 rounded-xl border border-[#613c3a] bg-[#2c2020] p-4"><p className="text-sm text-[#e8aaa3]">{message}</p><button onClick={onRetry} className="shrink-0 text-xs font-semibold text-[#f0b7ac] underline underline-offset-4">{copy.ar.retry}</button></div>;
}
function InlineError({message}:{message:string}) {return <p role="alert" className="my-3 rounded-lg border border-[#743b3b] bg-[#3b2223] px-3 py-2 text-sm text-[#f1a7a3]">{message}</p>;}
function SkeletonLine() {return <div className="h-10 animate-pulse rounded-lg bg-[#253032]"/>;}
function SkeletonRows() {return <div className="space-y-3">{[0,1,2].map(i=><div key={i} className="h-[76px] animate-pulse rounded-2xl border border-[#293638] bg-[#171f22]"/>)}</div>;}
function SkeletonCards() {return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0,1,2,3].map(i=><div key={i} className="h-32 animate-pulse rounded-2xl border border-[#293638] bg-[#171f22]"/>)}</div>;}
function LoadingScreen() {return <div className="grid min-h-[100dvh] place-items-center bg-[#11171c]"><div className="w-64 space-y-3"><div className="h-10 animate-pulse rounded-xl bg-[#243033]"/><div className="h-5 animate-pulse rounded-lg bg-[#202a2c]"/><div className="h-5 w-3/4 animate-pulse rounded-lg bg-[#202a2c]"/></div></div>;}
function AuthRequired({locale}:{locale:Locale}) {const ar=locale==='ar';return <div className="grid min-h-[100dvh] place-items-center bg-[#11171c] p-5 text-[#e8efee]"><div className="max-w-md text-center"><BrandMark/><h1 className="mt-5 text-2xl font-semibold">{ar?'سجّل الدخول للمتابعة':'Sign in to continue'}</h1><p className="mt-2 text-sm text-[#91a09f]">{ar?'تحتاج إلى حساب لإدارة متجرك.':'Your account is required to manage your store.'}</p><Link href="/login" className="mt-6 inline-flex rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d]">{copy[locale].login}</Link></div></div>;}
function NotFound() {const [locale]=useLocale();const ar=locale==='ar';return <div dir={ar?'rtl':'ltr'} className="grid min-h-[100dvh] place-items-center bg-[#11171c] p-6 text-center text-[#e8efee]"><div><p className="font-mono text-xs text-[#66d8af]">404</p><h1 className="mt-3 text-3xl font-semibold">{ar?'هذه الصفحة غير موجودة.':'This page isn’t available.'}</h1><Link href="/" className="mt-5 inline-flex text-sm text-[#76dcb6] underline">{ar?'العودة إلى LootBot':'Back to LootBot'}</Link></div></div>;}
function Pager({page,pageSize,total,setPage,t}:{page:number;pageSize:number;total:number;setPage:(n:number)=>void;t:typeof copy.ar}) {
  const max=Math.max(1,Math.ceil(total/pageSize));return <div className="mt-4 flex items-center justify-between text-xs text-[#879595]"><span>{(page-1)*pageSize+1}–{Math.min(page*pageSize,total)} / {total}</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>setPage(page-1)} className="rounded-lg border border-[#354344] px-3 py-2 disabled:opacity-40">{t.previous}</button><span className="px-2 py-2 font-mono">{page} / {max}</span><button disabled={page>=max} onClick={()=>setPage(page+1)} className="rounded-lg border border-[#354344] px-3 py-2 disabled:opacity-40">{t.next}</button></div></div>;
}
function formatPrice(price:number,currency:string,locale:Locale){try{return new Intl.NumberFormat(locale==='ar'?'ar-SA':'en',{style:'currency',currency}).format(price);}catch{return `${price} ${currency}`;}}
export default App;
