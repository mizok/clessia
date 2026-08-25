import { z } from '@hono/zod-openapi';

const DB_UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const DbUuidSchema = z.string().regex(DB_UUID_PATTERN, 'Invalid UUID').openapi({
  format: 'uuid',
});

export const NullableDbUuidSchema = DbUuidSchema.nullable();
