import { describe, expect, it } from 'vitest';
import { practiceCategoriesSchema } from '../apps/web/lib/contracts.ts';

const category = {
  id: '550e8400-e29b-41d4-a716-446655440101',
  slug: 'road-signs',
  nameThai: 'ป้ายจราจร',
  nameEnglish: 'Road signs',
  nameRussian: 'Дорожные знаки',
  questionCount: 2,
};

const categoryAt = (index: number) => ({
  ...category,
  id: `550e8400-e29b-41d4-a716-${index.toString(16).padStart(12, '0')}`,
  slug: `category-${index}`,
});

describe('Mini App practice category contract', () => {
  it('rejects case-variant duplicate UUIDs while preserving a valid UUID value', () => {
    const uppercaseId = category.id.toUpperCase();
    expect(practiceCategoriesSchema.safeParse({
      categories: [category, { ...category, id: uppercaseId, slug: 'same-id-different-case' }],
    }).success).toBe(false);

    const parsed = practiceCategoriesSchema.parse({ categories: [{ ...category, id: uppercaseId }] });
    expect(parsed.categories[0]?.id).toBe(uppercaseId);
  });

  it('accepts 100 categories and rejects 101 categories', () => {
    const categories = Array.from({ length: 101 }, (_, index) => categoryAt(index + 1));
    expect(practiceCategoriesSchema.safeParse({ categories: categories.slice(0, 100) }).success).toBe(true);
    expect(practiceCategoriesSchema.safeParse({ categories }).success).toBe(false);
  });

  it.each([
    ['a blank string', { ...category, nameEnglish: '' }],
    ['an untrimmed string', { ...category, slug: ' road-signs' }],
    ['a zero question count', { ...category, questionCount: 0 }],
    ['a fractional question count', { ...category, questionCount: 1.5 }],
    ['an unknown item member', { ...category, sortOrder: 1 }],
  ])('rejects %s', (_case, invalidCategory) => {
    expect(practiceCategoriesSchema.safeParse({ categories: [invalidCategory] }).success).toBe(false);
  });

  it('rejects an extra top-level envelope member', () => {
    expect(practiceCategoriesSchema.safeParse({ categories: [category], extra: true }).success).toBe(false);
  });
});
