import { useEffect, useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

type Option = { value: string; label: string };
type Page = { options: Option[]; hasMore: boolean; selectedOption: Option | null };
const input = 'mt-2 w-full min-w-0 rounded-lg border border-[#354344] bg-[#182123] p-2 text-sm';
const button = 'rounded-lg border border-[#354344] px-3 py-2 text-xs disabled:opacity-40';

export function StudioTargetPicker({ storeId, kind, value, ar, label, placeholder, onChange }: {
  storeId: string;
  kind: 'products' | 'categories' | 'customers';
  value: string;
  ar: boolean;
  label: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setSearch(''); setQuery(''); }, [storeId, kind]);
  const choices = useInfiniteQuery({
    queryKey: ['studio-options', storeId, kind, query, value],
    enabled: !!storeId,
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/studio/options/${kind}?q=${encodeURIComponent(query)}&page=${pageParam}&selected=${encodeURIComponent(value)}`, { credentials: 'include', signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (ar ? 'تعذر تحميل الخيارات.' : 'Could not load choices.'));
      return payload as Page;
    },
    getNextPageParam: (last, pages) => last.hasMore ? pages.length + 1 : undefined,
  });
  const options = [...new Map((choices.data?.pages.flatMap(page => page.options) ?? []).map(option => [option.value, option])).values()];
  const selected = choices.data?.pages.find(page => page.selectedOption?.value === value)?.selectedOption;
  const savedMissing = !!value && !choices.isPending && !choices.isError && !selected;
  return <div className="mt-3 min-w-0 space-y-2">
    <label htmlFor={id} className="block text-xs">{label}</label>
    <input className={input} maxLength={100} aria-label={`${label} — ${ar ? 'البحث بالاسم' : 'Search by name'}`} placeholder={ar ? 'ابحث بالاسم' : 'Search by name'} value={search} onChange={event => setSearch(event.target.value)}/>
    <select id={id} className={input} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{placeholder ?? (ar ? 'اختر الهدف' : 'Choose target')}</option>
      {value && !options.some(option => option.value === value) && <option value={value}>{selected?.label ?? (choices.isPending ? ar ? 'جار تحميل الهدف المحفوظ…' : 'Loading saved target…' : choices.isError ? ar ? 'الهدف المحفوظ (تعذر التحقق)' : 'Saved target (could not verify)' : ar ? 'الهدف المحفوظ غير متاح؛ اختر هدفًا آخر' : 'Saved target unavailable; choose another')}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {choices.isPending && <p role="status" className="text-xs text-[#94a0ad]">{ar ? 'جار تحميل الخيارات…' : 'Loading choices…'}</p>}
    {choices.isError && <div role="alert" className="space-y-2"><p className="text-xs text-[#e4a09a]">{choices.error instanceof Error ? choices.error.message : ar ? 'تعذر تحميل الخيارات.' : 'Could not load choices.'}</p><button type="button" className={button} onClick={() => void choices.refetch()}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>}
    {!choices.isPending && !choices.isError && !options.length && <p className="text-xs text-[#94a0ad]">{ar ? 'لا توجد نتائج تطابق البحث.' : 'No results match your search.'}</p>}
    {savedMissing && <p className="text-xs text-[#e5c996]">{ar ? 'الهدف المحفوظ لم يعد متاحًا في المتجر. يبقى محفوظًا حتى تختار بديلًا.' : 'The saved target is unavailable in this store. It is preserved until you choose a replacement.'}</p>}
    {choices.hasNextPage && <button type="button" className={button} disabled={choices.isFetchingNextPage} onClick={() => void choices.fetchNextPage()}>{choices.isFetchingNextPage ? ar ? 'جار التحميل…' : 'Loading…' : ar ? 'تحميل المزيد' : 'Load more'}</button>}
  </div>;
}
