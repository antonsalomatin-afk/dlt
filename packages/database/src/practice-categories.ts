import { z } from 'zod';

const trimmedNonblankString = z.string().min(1).refine((value) => value === value.trim());

export const practiceCategorySchema = z.strictObject({
  id: z.uuid(),
  slug: trimmedNonblankString,
  nameThai: trimmedNonblankString,
  nameEnglish: trimmedNonblankString,
  nameRussian: trimmedNonblankString,
  questionCount: z.number().int().positive(),
});

export const practiceCategoriesResponseSchema = z.strictObject({
  categories: z.array(practiceCategorySchema).max(100),
});
