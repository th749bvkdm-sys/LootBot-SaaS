import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGetStoreBotQueryKey, getGetDashboardSummaryQueryKey, getListStoresQueryKey } from '@workspace/api-client-react';

type Health = { status: string; lastError: string | null; lastSuccessfulPollAt: string | null; lastConnectionTestAt: string | null; lastConnectionTestError: string | null };
export function TelegramHealth({ storeId, csrfToken, locale }: { storeId: string; csrfToken?: string; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const qc=useQueryClient();
  const currentStore=useRef(storeId);currentStore.current=storeId;
  const requestVersion=useRef(0);const lastStatus=useRef<{storeId:string;status:string}|null>(null);
  const [pending, setPending] = useState(''); const [result, setResult] = useState(''); const [error, setError] = useState('');
  useEffect(()=>{requestVersion.current++;setResult('');setError('');setPending('');},[storeId]);
  const query = useQuery({ queryKey: ['telegram-health', storeId], enabled: !!storeId, refetchOnWindowFocus: false, refetchInterval: q=>['connected','error'].includes(q.state.data?.status??'')?15_000:false, queryFn: async () => {
    const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/health`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load connection health'); return response.json() as Promise<Health>;
  } });
  useEffect(()=>{
    const status=query.data?.status;if(!status)return;
    if(lastStatus.current?.storeId===storeId&&lastStatus.current.status!==status){void qc.invalidateQueries({queryKey:getGetStoreBotQueryKey(storeId)});void qc.invalidateQueries({queryKey:getListStoresQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})});void qc.invalidateQueries({queryKey:['workspace-summary',storeId]});}
    lastStatus.current={storeId,status};
  },[query.data?.status,storeId,qc]);
  const run = async (action:'test-connection'|'reconnect') => {
    if (!csrfToken || pending) return;
    const version=++requestVersion.current;
    setPending(action); setResult(''); setError('');
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/${action}`, {
        method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken },
      });
      const payload = await response.json();
      if (!response.ok || (action==='test-connection'?!payload.ok:!payload.connected)) throw new Error(payload.error || (ar ? 'تعذر الاتصال.' : 'Connection failed.'));
      if(currentStore.current===storeId&&requestVersion.current===version)setResult(action==='reconnect'?(ar?'تم استئناف استقبال البوت باستخدام الاتصال المحفوظ.':'Bot reception resumed using the saved connection.'):(ar ? 'نجح فحص رمز البوت واتصال Telegram. الاختبار لا يستأنف الاستقبال.' : 'Credentials and connectivity verified. Testing does not resume reception.'));
      if(action==='reconnect')await Promise.all([qc.invalidateQueries({queryKey:getGetStoreBotQueryKey(storeId)}),qc.invalidateQueries({queryKey:getListStoresQueryKey()}),qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey({storeId})}),qc.invalidateQueries({queryKey:['workspace-summary',storeId]})]);
    } catch (cause) { if(currentStore.current===storeId&&requestVersion.current===version)setError(cause instanceof Error ? cause.message : (ar ? 'تعذر الاختبار.' : 'Test failed.')); }
    finally { if(currentStore.current===storeId&&requestVersion.current===version)setPending(''); void qc.invalidateQueries({queryKey:['telegram-health',storeId]}); }
  };
  const date = (value: string | null) => value ? new Date(value).toLocaleString(ar ? 'ar-SA' : 'en-GB') : (ar ? 'لم يسجّل بعد' : 'Not recorded yet');
  if (!storeId) return null;
  return <section className="mt-5 rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{ar ? 'صحة اتصال البوت' : 'Bot connection health'}</h2><div className="flex flex-wrap gap-2">{csrfToken&&query.data?.status==='error'&&<button disabled={!!pending} onClick={()=>void run('reconnect')} className="rounded-xl bg-[#62d6aa] px-4 py-2 text-sm font-semibold text-[#10231d] disabled:opacity-40">{pending==='reconnect'?(ar?'جار استئناف الاتصال…':'Resuming…'):(ar?'استئناف الاتصال':'Resume connection')}</button>}<button disabled={!csrfToken || !!pending || query.isLoading || !query.data || query.data.status === 'disconnected'} onClick={() => void run('test-connection')} className="rounded-xl border border-[#365749] px-4 py-2 text-sm text-[#85dabc] disabled:opacity-40">{pending==='test-connection' ? (ar ? 'جار الاختبار…' : 'Testing…') : (ar ? 'اختبار الاتصال' : 'Test connection')}</button></div></div>
    {csrfToken&&query.data?.status==='error'&&<p className="mt-4 text-sm leading-6 text-[#e5c996]">{ar?'يوجد اتصال محفوظ للبوت، لكن الاستقبال متوقف أو يواجه خطأ. اضغط استئناف الاتصال لإعادة التحقق وتشغيله دون إدخال الرمز مرة أخرى.':'A saved bot connection needs attention. Resume to verify it and restart reception without re-entering its token.'}</p>}
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
