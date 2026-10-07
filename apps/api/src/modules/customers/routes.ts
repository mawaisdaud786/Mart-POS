import { schema } from '@retailos/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const { customerLedgerEntries, customers } = schema;

const CustomerCreate = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(1000).optional(),
  creditLimit: z.number().int().nonnegative().default(0),
});

const CustomerView = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  creditLimit: z.number(),
  balance: z.number(),
  createdAt: z.string(),
});

export const customersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    { schema: { response: { 200: z.object({ items: z.array(CustomerView) }) } }, config: { permission: 'customers.view' } },
    async (request) => {
      const rows = await request.ctx.tdb.select(customers, isNull(customers.deletedAt)).orderBy(asc(customers.name));
      const ledger = rows.length
        ? await request.ctx.tdb.select(customerLedgerEntries, inArray(customerLedgerEntries.customerId, rows.map((customer) => customer.id)))
        : [];
      const balances = new Map<string, number>();
      for (const entry of ledger) balances.set(entry.customerId, (balances.get(entry.customerId) ?? 0) + entry.amount);
      const canViewBalance = request.ctx.permissions.has('customers.view_balance');
      return {
        items: rows.map((customer) => ({
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          creditLimit: customer.creditLimit,
          balance: canViewBalance ? balances.get(customer.id) ?? 0 : 0,
          createdAt: customer.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/',
    { schema: { body: CustomerCreate, response: { 200: CustomerView } }, config: { permission: 'customers.manage', write: true } },
    async (request) => {
      const { ctx } = request;
      const input = request.body;
      const existing = (await ctx.tdb.select(customers, eq(customers.id, input.id)))[0];
      if (existing) {
        return {
          id: existing.id,
          name: existing.name,
          phone: existing.phone,
          address: existing.address,
          creditLimit: existing.creditLimit,
          balance: 0,
          createdAt: existing.createdAt.toISOString(),
        };
      }
      const date = new Date();
      await ctx.tdb.insert(customers, {
        id: input.id,
        tenantId: ctx.tenantId,
        name: input.name,
        phone: input.phone || null,
        address: input.address || null,
        creditLimit: input.creditLimit,
        createdAt: date,
        createdBy: ctx.userId,
        updatedAt: date,
        updatedBy: ctx.userId,
      });
      return { id: input.id, name: input.name, phone: input.phone || null, address: input.address || null, creditLimit: input.creditLimit, balance: 0, createdAt: date.toISOString() };
    },
  );

  app.get(
    '/:id/ledger',
    {
      schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ items: z.array(z.record(z.string(), z.unknown())), balance: z.number() }) } },
      config: { permission: 'customers.view_balance' },
    },
    async (request) => {
      const customer = (await request.ctx.tdb.select(customers, and(eq(customers.id, request.params.id), isNull(customers.deletedAt))))[0];
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
      const rows = await request.ctx.tdb.select(customerLedgerEntries, eq(customerLedgerEntries.customerId, request.params.id)).orderBy(asc(customerLedgerEntries.occurredAt));
      return { items: rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString(), receivedAt: row.receivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), balance: rows.reduce((sum, row) => sum + row.amount, 0) };
    },
  );

  app.post(
    '/:id/payments',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ id: z.uuid(), amount: z.number().int().positive(), accountId: z.enum(['acc-cash', 'acc-bank', 'acc-easypaisa', 'acc-jazzcash']), note: z.string().trim().max(500).optional() }),
        response: { 200: z.object({ id: z.string(), balance: z.number() }) },
      },
      config: { permission: 'customers.receive_payment', write: true },
    },
    async (request) => {
      if (!request.ctx.device) throw new AppError(403, 'DEVICE_REQUIRED', 'Register this device before recording customer payments');
      const { ctx } = request;
      return ctx.tdb.transaction(async (tdb) => {
        const customer = (await tdb.select(customers, and(eq(customers.id, request.params.id), isNull(customers.deletedAt))))[0];
        if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
        const rows = await tdb.select(customerLedgerEntries, eq(customerLedgerEntries.customerId, customer.id));
        const existing = rows.find((row) => row.id === request.body.id);
        if (existing) return { id: existing.id, balance: rows.reduce((sum, row) => sum + row.amount, 0) };
        const balance = rows.reduce((sum, row) => sum + row.amount, 0) - request.body.amount;
        const id = request.body.id;
        const date = new Date();
        await tdb.insert(customerLedgerEntries, {
          id,
          tenantId: ctx.tenantId,
          branchId: ctx.device!.branchId,
          occurredAt: date,
          receivedAt: date,
          customerId: customer.id,
          amount: -request.body.amount,
          type: 'payment',
          accountId: request.body.accountId,
          note: request.body.note ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
        return { id, balance };
      });
    },
  );
};
