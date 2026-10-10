export * from '../../../../lib/api-zod/src/learning';
import { newLessonStep as createStep } from '../../../../lib/api-zod/src/learning';
export const newLessonStep = () => createStep(() => crypto.randomUUID());
