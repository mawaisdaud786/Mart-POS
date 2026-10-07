import { z } from 'zod';

/** Query sent to `GET /shop/c/:collection`. Everything is optional. */
export const ListQuery = z.object({
  /** k1 (date) from / to, both inclusive. */
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  k2: z.string().max(80).optional(),
  /** k2 starts with this text (e.g. "customer:" for all customer khata entries). */
  k2Prefix: z.string().max(80).optional(),
  k3: z.string().max(40).optional(),
  k4: z.string().max(80).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(50_000).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;
