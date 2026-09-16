import { z } from 'zod';

export const favoriteRequestSchema = z.strictObject({
  presentationId: z.uuid(),
  favorite: z.boolean(),
});

export const favoriteResponseSchema = favoriteRequestSchema;
