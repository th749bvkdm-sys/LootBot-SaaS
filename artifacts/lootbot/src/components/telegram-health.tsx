import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type Health = { status: string; lastError: string | null; lastSuccessfulPollAt: string | null; lastConnectionTestAt: string | null; lastConnectionTestError: string | null };
export function TelegramHealth({ storeId, csrfToken, locale }: { storeId: string; csrfToken?: string; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [pending, setPending] = useState(false); const [result, setResult] = useState(''); const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['telegram-health', storeId], enabled: !!storeId, refetchOnWindowFocus: false, queryFn: async () => {
    const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/health`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load connection health'); return response.json() as Promise<Health>;
  } });
  const test = async () => {
    if (!csrfToken || pending) return;
    setPending(true); setResult(''); setError('');
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/test-connection`, {
        method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken },
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || (ar ? 'تعذر الاتصال.' : 'Connection failed.'));
      setResult(ar ? 'نجح فحص رمز البوت واتصال Telegram.' : 'Bot credentials and Telegram connection verified.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : (ar ? 'تعذر الاختبار.' : 'Test failed.')); }
    finally { setPending(false); void query.refetch(); }
  };
  const date = (value: string | null) => value ? new Date(value).toLocaleString(ar ? 'ar-SA' : 'en-GB') : (ar ? 'لم يسجّل بعد' : 'Not recorded yet');
  if (!storeId) return null;
  return <section className="mt-5 rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{ar ? 'صحة اتصال البوت' : 'Bot connection health'}</h2><button disabled={!csrfToken || pending || query.isLoading || !query.data || query.data.status === 'disconnected'} onClick={() => void test()} className="rounded-xl border border-[#365749] px-4 py-2 text-sm text-[#85dabc] disabled:opacity-40">{pending ? (ar ? 'جار الاختبار…' : 'Testing…') : (ar ? 'اختبار الاتصال' : 'Test connection')}</button></div>
    {query.isLoading ? <p className="mt-4 text-sm">{ar ? 'جار التحميل…' : 'Loading…'}</p> : query.isError ? <button onClick={() => void query.refetch()} className="mt-4 text-sm text-[#e4a09a]">{ar ? 'تعذر تحميل حالة الاتصال. إعادة المحاولة' : 'Could not load health. Retry'}</button> : query.data && <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
      <div><dt className="text-[#879595]">{ar ? 'آخر استقبال ناجح من Telegram' : 'Last successful Telegram poll'}</dt><dd className="mt-2">{date(query.data.lastSuccessfulPollAt)}</dd></div>
      <div><dt className="text-[#879595]">{ar ? 'آخر اختبار اتصال' : 'Last connection test'}</dt><dd className="mt-2">{date(query.data.lastConnectionTestAt)}</dd></div>
      <div><dt className="text-[#879595]">{ar ? 'آخر خطأ استقبال' : 'Latest polling error'}</dt><dd className="mt-2 text-[#e4a09a]">{query.data.lastError ?? (ar ? 'لا يوجد خطأ مسجّل' : 'No recorded error')}</dd></div>
      <div><dt className="text-[#879595]">{ar ? 'نتيجة آخر اختبار' : 'Latest test result'}</dt><dd className="mt-2">{query.data.lastConnectionTestError ?? (query.data.lastConnectionTestAt ? (ar ? 'ناجح' : 'Passed') : (ar ? 'لم يختبر بعد' : 'Not tested yet'))}</dd></div>
    </dl>}
    <p className="mt-4 text-xs leading-6 text-[#879595]">{ar ? 'يفحص الاختبار الرمز والاتصال. جرّب /start في Telegram للتأكد من ظهور القائمة للعملاء.' : 'The test checks credentials and connectivity. Try /start in Telegram to verify the customer menu.'}</p>
    {result && <p role="status" className="mt-3 text-sm text-[#85dabc]">{result}</p>}{error && <p role="alert" className="mt-3 text-sm text-[#e4a09a]">{error}</p>}
  </section>;
}
