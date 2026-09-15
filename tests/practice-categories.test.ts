import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { practiceCategoriesResponseSchema, practiceCategorySchema } from '../packages/database/src/practice-categories.ts';

const category = {
  id: randomUUID(),
  slug: 'road-signs',
  nameThai: 'ป้ายจราจร',
  nameEnglish: 'Road signs',
  nameRussian: 'Дорожные знаки',
  questionCount: 2,
};

describe('practice category contracts', () => {
  it('accepts only the minimal strict response envelope', () => {
    expect(practiceCategoriesResponseSchema.parse({ categories: [category] })).toEqual({ categories: [category] });
    expect(practiceCategoriesResponseSchema.parse({ categories: [] })).toEqual({ categories: [] });
    expect(practiceCategoriesResponseSchema.safeParse({ categories: [category], extra: true }).success).toBe(false);
    expect(practiceCategorySchema.safeParse({ ...category, sortOrder: 1 }).success).toBe(false);
  });

  it('rejects malformed persisted identity fields and counts', () => {
    for (const invalid of [
      { ...category, id: 'invalid' },
      { ...category, slug: '' },
      { ...category, slug: ' road-signs' },
      { ...category, nameThai: ' ' },
      { ...category, nameEnglish: 'Road signs ' },
      { ...category, nameRussian: '\nRoad signs' },
      { ...category, questionCount: 0 },
      { ...category, questionCount: 1.5 },
    ]) expect(practiceCategorySchema.safeParse(invalid).success).toBe(false);
  });

  it('enforces the 100-category response ceiling', () => {
    const categories = Array.from({ length: 101 }, (_, index) => ({
      ...category,
      id: randomUUID(),
      slug: `category-${index}`,
    }));
    expect(practiceCategoriesResponseSchema.safeParse({ categories: categories.slice(0, 100) }).success).toBe(true);
    expect(practiceCategoriesResponseSchema.safeParse({ categories }).success).toBe(false);
  });
});
