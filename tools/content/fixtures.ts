import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';

export const categoryKeys = ['signs', 'traffic-law', 'safe-driving', 'vehicle-maintenance', 'hazard-perception'] as const;
const text = z.string().trim().min(1).max(4000);
const stableKey = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const localized = { textEnglish: text, textThai: text.optional(), textRussian: text.optional() };
const fixtureSchema = z.strictObject({
  namespace: z.literal('thaidlt-development-v1'),
  sourceType: z.literal('FIXTURE'),
  provenance: z.literal('Original synthetic development content; not official DLT questions or verified legal guidance.'),
  categories: z.array(z.strictObject({ key: z.enum(categoryKeys), nameThai: text, nameEnglish: text, nameRussian: text })).length(5),
  concepts: z.array(z.strictObject({ key: stableKey, nameThai: text, nameEnglish: text, nameRussian: text })).min(1).max(25),
  questions: z.array(z.strictObject({
    id: stableKey, category: z.enum(categoryKeys), concept: stableKey,
    vehicleType: z.enum(['CAR', 'MOTORCYCLE']), ...localized,
    textExamEnglish: text.startsWith('Synthetic exam-style: ').optional(),
    explanationEnglish: text, explanationThai: text.optional(), explanationRussian: text.optional(),
    choices: z.array(z.strictObject({ key: z.enum(['A', 'B', 'C', 'D']), ...localized, isCorrect: z.boolean() })).length(4),
  })).length(25),
}).superRefine((data, context) => {
  function reject(message: string) { context.addIssue({ code: 'custom', message }); }
  if (new Set(data.categories.map(({ key }) => key)).size !== 5) reject('Each category must occur once.');
  if (new Set(data.questions.map(({ id }) => id)).size !== 25) reject('Question IDs must be unique.');
  if (new Set(data.questions.map(({ category }) => category)).size !== 5) reject('Questions must cover all five categories.');
  if (new Set(data.questions.map(({ vehicleType }) => vehicleType)).size !== 2) reject('Both vehicles must be represented.');
  const conceptKeys = new Set(data.concepts.map(({ key }) => key));
  if (conceptKeys.size !== data.concepts.length) reject('Concept keys must be unique.');
  const conceptUsage = new Map<string, number>();
  for (const question of data.questions) {
    if (!conceptKeys.has(question.concept)) reject('Each question must reference a declared concept.');
    conceptUsage.set(question.concept, (conceptUsage.get(question.concept) ?? 0) + 1);
  }
  if (conceptUsage.size !== conceptKeys.size) reject('Each declared concept must group at least one question.');
  if (![...conceptUsage.values()].some((count) => count >= 2)) reject('At least one concept must group two or more question variants.');
  for (const question of data.questions) {
    if (new Set(question.choices.map(({ key }) => key)).size !== 4) reject('Each choice key A–D must occur once.');
    if (question.choices.filter(({ isCorrect }) => isCorrect).length !== 1) reject('Exactly one choice must be correct.');
  }
  if (!data.questions.some((question) => question.textThai && question.textRussian && question.textExamEnglish
    && question.explanationThai && question.explanationRussian
    && question.choices.every((choice) => choice.textThai && choice.textRussian))) reject('One complete multilingual example is required.');
});

export function validateFixtures(input: unknown) {
  const result = fixtureSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid development fixtures: structure, coverage, text, identity or answer invariant failed.');
  return result.data;
}

export function fixtureId(key: string) {
  const hash = createHash('sha256').update(`thaidlt-development-v1:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function importFixtures(database: PrismaClient, input: unknown) {
  const fixtures = validateFixtures(input);
  await database.$transaction(async (transaction) => {
    for (const [sortOrder, category] of fixtures.categories.entries()) {
      const id = fixtureId(`category:${category.key}`);
      const slug = `fixture-${category.key}`;
      const names = { nameThai: category.nameThai, nameEnglish: category.nameEnglish, nameRussian: category.nameRussian };
      const existing = await transaction.category.findFirst({ where: { OR: [{ id }, { slug }] } });
      if (existing) {
        if (existing.id !== id || existing.slug !== slug || existing.nameThai !== names.nameThai
          || existing.nameEnglish !== names.nameEnglish || existing.nameRussian !== names.nameRussian) throw new Error('Fixture category collision.');
      } else await transaction.category.create({ data: { id, slug, ...names, sortOrder } });
    }
    for (const concept of fixtures.concepts) {
      const id = fixtureId(`concept:${concept.key}`);
      const slug = `fixture-${concept.key}`;
      const names = { nameThai: concept.nameThai, nameEnglish: concept.nameEnglish, nameRussian: concept.nameRussian };
      const existing = await transaction.concept.findFirst({ where: { OR: [{ id }, { slug }] } });
      if (existing) {
        if (existing.id !== id || existing.slug !== slug || existing.nameThai !== names.nameThai
          || existing.nameEnglish !== names.nameEnglish || existing.nameRussian !== names.nameRussian) throw new Error('Fixture concept collision.');
      } else await transaction.concept.create({ data: { id, slug, ...names } });
    }
    for (const question of fixtures.questions) {
      const { id: stableKey, category, concept, choices, ...wording } = question;
      const id = fixtureId(`question:${stableKey}`);
      const sourceReference = `development:thaidlt-development-v1:${stableKey}`;
      const existing = await transaction.question.findUnique({ where: { id }, include: { choices: true } });
      if (existing && (existing.sourceType !== 'FIXTURE' || existing.sourceReference !== sourceReference
        || existing.active || existing.verificationStatus !== 'DRAFT'
        || existing.choices.some((choice) => choice.id !== fixtureId(`choice:${question.id}:${choice.key}`)))) throw new Error('Fixture question collision.');
      const data = { ...wording, categoryId: fixtureId(`category:${category}`), conceptId: fixtureId(`concept:${concept}`), sourceType: 'FIXTURE' as const,
        textThai: wording.textThai ?? null, textRussian: wording.textRussian ?? null,
        textExamEnglish: wording.textExamEnglish ?? null, explanationThai: wording.explanationThai ?? null,
        explanationRussian: wording.explanationRussian ?? null,
        sourceReference, active: false, verificationStatus: 'DRAFT' as const };
      await transaction.question.upsert({ where: { id }, create: { id, ...data }, update: data });
      for (const choice of choices) {
        const choiceId = fixtureId(`choice:${question.id}:${choice.key}`);
        const collision = await transaction.questionChoice.findUnique({ where: { id: choiceId } });
        if (collision && collision.questionId !== id) throw new Error('Fixture choice collision.');
        const choiceData = { ...choice, textThai: choice.textThai ?? null, textRussian: choice.textRussian ?? null };
        await transaction.questionChoice.upsert({ where: { id: choiceId }, create: { id: choiceId, questionId: id, ...choiceData }, update: choiceData });
      }
    }
  }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 5000 });
  return { questions: 25, choices: 100, categories: 5, concepts: fixtures.concepts.length };
}
