import type { WorkspaceSummary } from './workspace-summary';

const labels = {
  ar: { productsPerStore: 'المنتجات', categoriesPerStore: 'التصنيفات', ordersPerMonth: 'طلبات الشهر', stores: 'المتاجر' },
  en: { productsPerStore: 'Products', categoriesPerStore: 'Categories', ordersPerMonth: 'Monthly orders', stores: 'Stores' },
};

export function PlanUsage({ data, ar }: { data: Pick<WorkspaceSummary, 'usage' | 'limits'>; ar: boolean }) {
  return <div className="mt-5 grid gap-4 sm:grid-cols-2">{Object.keys(labels.ar).map(key => {
    const used = data.usage[key] ?? 0;
    const limit = data.limits[key] ?? 0;
    const percent = Math.min(100, limit ? used / limit * 100 : 0);
    return <div key={key}>
      <div className="flex justify-between gap-2 text-xs text-[#97a4af]"><span>{labels[ar ? 'ar' : 'en'][key as keyof typeof labels.ar]}</span><span dir="ltr">{used} / {limit}</span></div>
      <div className="mt-2 h-1.5 rounded-full bg-[#303b49]"><div className={`h-full rounded-full ${percent >= 80 ? 'bg-[#e0b87d]' : 'bg-[#aa9bf4]'}`} style={{ width: `${percent}%` }}/></div>
    </div>;
  })}</div>;
}
