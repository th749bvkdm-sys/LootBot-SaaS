import { db, auditLogsTable } from "@workspace/db";
import { createId } from "./security";

export async function writeAuditEvent(input: {
  userId?: string | null;
  storeId?: string | null;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogsTable).values({
    id: createId(),
    userId: input.userId ?? null,
    storeId: input.storeId ?? null,
    action: input.action,
    summary: input.summary,
    details: input.details ?? {},
  });
}