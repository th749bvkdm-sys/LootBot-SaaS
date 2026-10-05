import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LockKeyhole, RefreshCw, X } from 'lucide-react';

export const workspaceInput = 'workspace-input w-full rounded-xl border border-[#354344] bg-[#182123] px-3 py-2.5 text-sm';
export const workspaceButton = 'workspace-button inline-flex items-center justify-center gap-2 rounded-xl border border-[#354344] px-4 py-2.5 text-sm font-medium disabled:opacity-40';
export function WorkspaceHeading({ title, description, eyebrow, children }: { title: string; description: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div className="min-w-0"><p className="mb-2 text-xs font-medium text-[#aa9bf4]">{eyebrow ?? 'LootBot Workspace'}</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-7 text-[#97a4af]">{description}</p></div>{children}</header>;
}
export function WorkspaceCard({ title, description, children, className = '' }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`workspace-card min-w-0 rounded-2xl border border-[#303b49] bg-[#171f27] p-5 sm:p-6 ${className}`}>{title && <h2 className="font-semibold">{title}</h2>}{description && <p className="mt-2 text-xs leading-6 text-[#97a4af]">{description}</p>}{children}</section>;
}
export function WorkspaceError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <div role="alert" className="my-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#743b3b] bg-[#3b2223] p-4 text-sm text-[#f1a7a3]"><span>{error instanceof Error ? error.message : String(error)}</span><button onClick={onRetry} className={workspaceButton}><RefreshCw className="h-4 w-4"/>إعادة المحاولة / Retry</button></div>;
}
export function WorkspaceSkeleton() { return <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(key => <div key={key} className="h-36 animate-pulse rounded-2xl border border-[#303b49] bg-[#171f27]"/>)}</div>; }
export function UpgradeButton({ ar, requiredPlan = 'BUSINESS', className = '' }: { ar: boolean; requiredPlan?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)} className={`${workspaceButton} ${className}`}><LockKeyhole className="h-4 w-4"/>{ar ? `عرض خطة ${requiredPlan}` : `View ${requiredPlan} plan`}</button><UpgradeDialog ar={ar} requiredPlan={requiredPlan} open={open} onClose={() => setOpen(false)}/></>;
}
export function UpgradeDialog({ar,requiredPlan='BUSINESS',open,onClose}:{ar:boolean;requiredPlan?:string;open:boolean;onClose:()=>void}) {
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('[aria-labelledby="upgrade-title"]');
    dialog?.querySelector<HTMLElement>('button')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape')onClose();
      if(event.key==='Tab'&&dialog){const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button,a[href]'));const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('keydown',key);previous?.focus();};
  },[open,onClose]);
  return open ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="upgrade-title" className="w-full max-w-lg rounded-2xl border border-[#4b4565] bg-[#171f27] p-6 shadow-2xl" onClick={event => event.stopPropagation()}><button aria-label={ar ? 'إغلاق' : 'Close'} className="float-end rounded-lg p-2" onClick={onClose}><X className="h-5 w-5"/></button><p className="text-xs text-[#aa9bf4]">{requiredPlan}</p><h2 id="upgrade-title" className="mt-3 text-xl font-bold">{ar ? 'مساحة أوسع لنمو متجرك' : 'More room for your store'}</h2><p className="mt-3 text-sm leading-7 text-[#97a4af]">{ar ? 'تعرض صفحة الخطط الحدود والميزات الحالية. تُفعّل الباقات حاليًا من إدارة المنصة؛ لا يُحصّل أي مبلغ من هذا الزر.' : 'Compare current limits and features. Plans are currently assigned by platform administrators; this button does not charge you.'}</p><Link href="/dashboard/plans" onClick={onClose} className={`${workspaceButton} mt-5 w-full bg-[#aa9bf4] text-[#161329]`}>{ar ? 'مقارنة الخطط' : 'Compare plans'}</Link></section></div> : null;
}
export function LockedWorkspace({ ar, title, description, requiredPlan = 'BUSINESS' }: { ar: boolean; title: string; description: string; requiredPlan?: string }) {
  return <WorkspaceCard><div className="max-w-xl py-8"><div className="mb-5 inline-flex rounded-2xl bg-[#aa9bf4]/10 p-4 text-[#aa9bf4]"><LockKeyhole className="h-7 w-7"/></div><span className="ms-3 rounded-full border border-[#4b4565] px-3 py-1 text-xs text-[#c8bcff]">{requiredPlan}</span><h2 className="text-xl font-bold">{title}</h2><p className="my-4 text-sm leading-7 text-[#97a4af]">{description}</p><UpgradeButton ar={ar} requiredPlan={requiredPlan}/></div></WorkspaceCard>;
}
export async function workspaceRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
  return payload as T;
}
export function money(value: number, currency: string, ar: boolean) { try { return new Intl.NumberFormat(ar ? 'ar-SA' : 'en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${value} ${currency}`; } }
