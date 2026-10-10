import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { BrandMark } from './brand-mark';
import { teacherApi, type AccountWorkspace } from '../lib/teacher-api';

export function workspaceDestination(account: AccountWorkspace) {
  if (account.role === 'SUPERADMIN') return '/admin';
  if (!account.accountType) return '/account/select';
  if (account.accountType === 'teacher') return account.profileComplete ? '/teacher' : '/teacher/onboarding';
  return '/dashboard';
}

export function AccountAccess({ kind, children }: { kind: 'continue' | 'merchant' | 'teacher' | 'teacher-setup'; children?: ReactNode }) {
  const user = useGetCurrentUser();
  const [, navigate] = useLocation();
  const account = useQuery({ queryKey: ['account-workspace'], enabled: !!user.data, queryFn: () => teacherApi<AccountWorkspace>('/account/workspace'), retry: 1 });
  const data = account.data;
  const target = data ? !data.accountType && data.role !== 'SUPERADMIN' ? '/account/select'
    : kind === 'continue' ? workspaceDestination(data)
      : kind === 'merchant' && data.accountType === 'teacher' && data.role !== 'SUPERADMIN' ? workspaceDestination(data)
        : kind.startsWith('teacher') && data.accountType !== 'teacher' ? workspaceDestination(data)
          : kind === 'teacher' && !data.profileComplete ? '/teacher/onboarding' : null : null;
  useEffect(() => { if (target) navigate(target, { replace: true }); }, [target, navigate]);
  if (user.isError) return <main dir="rtl" className="glass-app grid min-h-dvh place-items-center p-5"><section className="glass-panel text-center"><BrandMark className="mx-auto"/><h1 className="mt-4 text-xl">سجّل الدخول للمتابعة</h1><Link className="brand-action mt-5 inline-block rounded-xl px-5 py-3" href="/login">تسجيل الدخول</Link></section></main>;
  if (account.isError) return <main dir="rtl" className="glass-app grid min-h-dvh place-items-center p-5"><section className="glass-panel"><p role="alert">تعذر تحميل نوع الحساب.</p><button className="mt-4 rounded-xl border px-4 py-2" onClick={() => void account.refetch()}>إعادة المحاولة</button></section></main>;
  if (user.isLoading || account.isLoading || target || !data) return <main className="glass-app grid min-h-dvh place-items-center" dir="rtl"><div role="status" className="text-center"><BrandMark className="mx-auto"/><p className="mt-4 glass-muted">جار فتح مساحة العمل…</p></div></main>;
  return <>{children}</>;
}
