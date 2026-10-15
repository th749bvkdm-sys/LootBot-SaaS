import { useCallback, useEffect, useRef, useState } from "react";
import { localRead, localWrite, quantApi, QuantError, type Row, type Stroke } from "./api";
type Pending = { body: Row; seq: number; conflict?: boolean };
type Queue = Record<string, Pending>;
export function useAttempt(id: string, userId: string) {
  const key = `lootbot:quant:${userId}:${id}:pending`, pending = useRef<Queue>({}), inFlight = useRef<Promise<boolean> | null>(null), loaded = useRef(false), disposed = useRef(false), savedRevisions = useRef<Record<string, number>>({});
  const [data, setData] = useState<Row | null>(null), [error, setError] = useState(""), [failure, setFailure] = useState(""), [queue, setQueue] = useState<Queue>({}), [saving, setSaving] = useState(false), [storageError, setStorageError] = useState(false), [clockOffset, setClockOffset] = useState(0);
  const publish = useCallback(() => { const copy = { ...pending.current }; setQueue(copy); setStorageError(!localWrite(key, Object.keys(copy).length ? copy : null)); }, [key]);
  const sync = (r: Row) => { if (r.serverTime) setClockOffset(new Date(r.serverTime).getTime() - Date.now()); };
  const refresh = useCallback(async () => {
    try { const r = await quantApi(`/attempts/${id}`); if (disposed.current) return; sync(r); setData(r); setError("");
      // Ownership has been verified by this GET before local student data is read.
      if (!loaded.current) { pending.current = localRead(key, {}); loaded.current = true; publish(); }
      if (r.attempt.status !== "in_progress") { pending.current = {}; publish(); }
      return r;
    } catch (e) { if (!disposed.current) setError(e instanceof Error ? e.message : "تعذر تحميل المحاولة."); return null; }
  }, [id, key, publish]);
  const flush = useCallback(async (scratch = true): Promise<boolean> => {
    // A navigation/submit request joins an automatic save instead of treating it as a conflict.
    while (inFlight.current) await inFlight.current;
    if (disposed.current) return false;
    const operation = (async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const [target, entry] of Object.entries(pending.current)) {
        if (entry.conflict || !scratch && target.startsWith("scratchpad/")) continue;
        try {
          const r = await quantApi(`/attempts/${id}/${target}`, "PUT", entry.body); sync(r);
          savedRevisions.current[target] = r.revision;
          const latest = pending.current[target];
          if (latest?.seq === entry.seq) delete pending.current[target]; else if (latest) latest.body.revision = r.revision;
          if (r.response) setData(prev => prev && { ...prev, responses: [...prev.responses.filter((x: Row) => x.questionVersionId !== r.response.questionVersionId), r.response] });
          publish();
        } catch (e) {
          setFailure(e instanceof Error ? e.message : "تعذر الحفظ.");
          if (e instanceof QuantError && e.details.code === "REVISION_CONFLICT") { const latest = pending.current[target]; if (latest) latest.conflict = true; }
          if (e instanceof QuantError && ["TIME_EXPIRED", "ATTEMPT_CLOSED"].includes(e.details.code)) await refresh();
          publish(); return false;
        }
      }
      setFailure("");
      return !Object.keys(pending.current).some(t => scratch || !t.startsWith("scratchpad/"));
    } finally { setSaving(false); }
    })();
    inFlight.current = operation;
    try { return await operation; }
    finally { if (inFlight.current === operation) inFlight.current = null; }
  }, [id, publish, refresh]);
  useEffect(() => { disposed.current = false; void refresh(); return () => { disposed.current = true; }; }, [refresh]);
  useEffect(() => { const online = () => void flush(); window.addEventListener("online", online); const timer = window.setInterval(() => { if (Object.keys(pending.current).length) void flush(); }, 10000); return () => { window.removeEventListener("online", online); clearInterval(timer); }; }, [flush]);
  useEffect(() => { const warning = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warning); return () => window.removeEventListener("beforeunload", warning); }, []);
  function enqueue(target: string, body: Row) {
    const previous = pending.current[target]; pending.current[target] = { body: { ...body, revision: previous?.body.revision ?? savedRevisions.current[target] ?? body.revision }, seq: (previous?.seq || 0) + 1, conflict: previous?.conflict }; publish();
  }
  function answer(versionId: string, patch: Row) {
    const server = data?.responses.find((r: Row) => r.questionVersionId === versionId) || { choiceKey: null, flagged: false, revision: 0 };
    const target = "answers/" + versionId, prev = pending.current[target]?.body || server;
    enqueue(target, { choiceKey: prev.choiceKey, flagged: prev.flagged, revision: prev.revision, ...patch });
  }
  function scratchpad(versionId: string, strokes: Stroke[], revision: number) { const target = "scratchpad/" + versionId; enqueue(target, { strokes, revision: savedRevisions.current[target] ?? revision }); }
  useEffect(() => { if (!Object.keys(queue).length) return; const timer = setTimeout(() => void flush(), Object.keys(queue).some(t => t.startsWith("scratchpad/")) ? 1500 : 250); return () => clearTimeout(timer); }, [queue, flush]);
  async function resolve(target: string, overwrite: boolean) {
    const latest = target.startsWith("scratchpad/") ? await quantApi(`/attempts/${id}/${target}`) : await refresh();
    const local = pending.current[target]; if (!local) return;
    if (!overwrite) { delete pending.current[target]; publish(); await refresh(); return; }
    const revision = target.startsWith("scratchpad/") ? latest?.revision : latest?.responses.find((r: Row) => "answers/" + r.questionVersionId === target)?.revision || 0;
    savedRevisions.current[target] = revision; local.body.revision = revision; local.conflict = false; publish(); await flush();
  }
  return { data, error, failure, queue, saving, storageError, clockOffset, refresh, flush, answer, scratchpad, resolve };
}
