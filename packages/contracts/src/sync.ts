import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/** Entities a device can push. Documents are create-only; master data can be updated/deleted. */
export const MASTER_ENTITIES = ['category', 'brand', 'product', 'product_unit', 'product_barcode'] as const;
export const DOCUMENT_ENTITIES = ['stock_adjustment'] as const;
export const PUSHABLE_ENTITIES = [...MASTER_ENTITIES, ...DOCUMENT_ENTITIES] as const;
export type PushableEntity = (typeof PUSHABLE_ENTITIES)[number];

/** Entities a device can receive in pull/snapshot. */
export const PULLABLE_ENTITIES = [
  ...PUSHABLE_ENTITIES,
  'branch',
  'setting',
  'unit',
  'inventory_balance',
  'inventory_movement',
  'tenant_profile',
] as const;
export type PullableEntity = (typeof PULLABLE_ENTITIES)[number];

export const Mutation = z.discriminatedUnion('op', [
  z.object({
    mutationId: Uuid,
    entity: z.enum(PUSHABLE_ENTITIES),
    op: z.literal('create'),
    id: Uuid,
    data: z.record(z.string(), z.unknown()),
    clientCreatedAt: IsoDateTime,
  }),
  z.object({
    mutationId: Uuid,
    entity: z.enum(MASTER_ENTITIES),
    op: z.literal('update'),
    id: Uuid,
    baseVersion: z.number().int().positive(),
    changes: z.record(z.string(), z.unknown()),
    clientCreatedAt: IsoDateTime,
  }),
  z.object({
    mutationId: Uuid,
    entity: z.enum(MASTER_ENTITIES),
    op: z.literal('delete'),
    id: Uuid,
    baseVersion: z.number().int().positive(),
    clientCreatedAt: IsoDateTime,
  }),
]);
export type Mutation = z.infer<typeof Mutation>;

export const PushBody = z.object({
  mutations: z.array(Mutation).min(1).max(100),
});
export type PushBody = z.infer<typeof PushBody>;

export const MutationResult = z.discriminatedUnion('status', [
  z.object({ mutationId: Uuid, status: z.literal('applied'), version: z.number().int().optional() }),
  z.object({
    mutationId: Uuid,
    status: z.literal('rejected'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    mutationId: Uuid,
    status: z.literal('conflict'),
    conflictId: Uuid,
    serverVersion: z.number().int(),
    fields: z.array(z.string()),
  }),
  z.object({ mutationId: Uuid, status: z.literal('retry'), message: z.string() }),
]);
export type MutationResult = z.infer<typeof MutationResult>;

export const PushResponse = z.object({
  results: z.array(MutationResult),
  serverTime: IsoDateTime,
});
export type PushResponse = z.infer<typeof PushResponse>;

export const PullQuery = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const Change = z.object({
  seq: z.number().int(),
  entity: z.enum(PULLABLE_ENTITIES),
  op: z.enum(['upsert', 'delete']),
  id: z.string(),
  /** Current server state (null for deletes or rows the device may not see). */
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type Change = z.infer<typeof Change>;

export const PullResponse = z.object({
  changes: z.array(Change),
  nextCursor: z.number().int(),
  hasMore: z.boolean(),
  serverTime: IsoDateTime,
});
export type PullResponse = z.infer<typeof PullResponse>;

export const SnapshotResponse = z.object({
  cursor: z.number().int(),
  entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  serverTime: IsoDateTime,
});
export type SnapshotResponse = z.infer<typeof SnapshotResponse>;
