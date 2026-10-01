import { z } from 'zod';

export const Uuid = z.uuid();
/** Integer paisa. */
export const Money = z.number().int().safe();
export const NonNegativeMoney = Money.nonnegative();
/** Quantity in integer thousandths (see @retailos/domain qty.ts). */
export const Qty = z.number().int().safe();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Name = z.string().trim().min(1).max(200);
export const OptionalText = (max: number) => z.string().trim().max(max).nullish();

export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
