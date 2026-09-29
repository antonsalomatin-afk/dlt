import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../../packages/database/src/index.ts';

export const categoryKeys = ['signs', 'traffic-law', 'safe-driving', 'vehicle-maintenance', 'hazard-perception'] as const;
const text = z.string().trim().min(1).max(4000);
const stableKey = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const conceptName = z.string().min(1).max(4000).refine((value) => value === value.trim() && value.length > 0);
const localized = { textEnglish: text, textThai: text.optional(), textRussian: text.optional() };
const fixtureSchema = z.strictObject({
  namespace: z.literal('thaidlt-development-v1'),
  sourceType: z.literal('FIXTURE'),
  provenance: z.literal('Original synthetic development content; not official DLT questions or verified legal guidance.'),
  concepts: z.array(z.strictObject({
    key: stableKey, nameThai: conceptName, nameEnglish: conceptName, nameRussian: conceptName,
  })).length(10),
  categories: z.array(z.strictObject({ key: z.enum(categoryKeys), nameThai: text, nameEnglish: text, nameRussian: text })).length(5),
  questions: z.array(z.strictObject({
    id: stableKey, category: z.enum(categoryKeys), concept: stableKey,
    vehicleType: z.enum(['CAR', 'MOTORCYCLE']), ...localized,
    textExamEnglish: text.startsWith('Synthetic exam-style: ').optional(),
    explanationEnglish: text, explanationThai: text.optional(), explanationRussian: text.optional(),
    choices: z.array(z.strictObject({ key: z.enum(['A', 'B', 'C', 'D']), ...localized, isCorrect: z.boolean() })).length(4),
  })).length(25),
}).superRefine((data, context) => {
  function reject(message: string) { context.addIssue({ code: 'custom', message }); }
  const conceptKeys = new Set(data.concepts.map(({ key }) => key));
  const conceptReferences = new Map(data.concepts.map(({ key }) => [key, 0]));
  if (conceptKeys.size !== 10) reject('Concept keys must be unique.');
  if (new Set(data.categories.map(({ key }) => key)).size !== 5) reject('Each category must occur once.');
  if (new Set(data.questions.map(({ id }) => id)).size !== 25) reject('Question IDs must be unique.');
  if (new Set(data.questions.map(({ category }) => category)).size !== 5) reject('Questions must cover all five categories.');
  if (new Set(data.questions.map(({ vehicleType }) => vehicleType)).size !== 2) reject('Both vehicles must be represented.');
  for (const question of data.questions) {
    if (!conceptKeys.has(question.concept)) reject('Every question must reference a declared concept.');
    else conceptReferences.set(question.concept, (conceptReferences.get(question.concept) ?? 0) + 1);
    if (new Set(question.choices.map(({ key }) => key)).size !== 4) reject('Each choice key A–D must occur once.');
    if (question.choices.filter(({ isCorrect }) => isCorrect).length !== 1) reject('Exactly one choice must be correct.');
  }
  if ([...conceptReferences.values()].some((count) => count === 0)) reject('Every concept must be used.');
  if ([...conceptReferences.values()].some((count) => count < 2)) reject('Every concept must group at least two question variants.');
  if ([...conceptReferences.values()].filter((count) => count >= 2).length < 5) reject('At least five concepts must group question variants.');
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
      const { id: questionKey, category, concept, choices, ...wording } = question;
      const id = fixtureId(`question:${questionKey}`);
      const conceptId = fixtureId(`concept:${concept}`);
      const sourceReference = `development:thaidlt-development-v1:${questionKey}`;
      const existing = await transaction.question.findUnique({ where: { id }, include: { choices: true } });
      if (existing && (existing.sourceType !== 'FIXTURE' || existing.sourceReference !== sourceReference
        || existing.active || existing.verificationStatus !== 'DRAFT'
        || (existing.conceptId !== null && existing.conceptId !== conceptId)
        || existing.choices.some((choice) => choice.id !== fixtureId(`choice:${question.id}:${choice.key}`)))) throw new Error('Fixture question collision.');
      const data = { ...wording, categoryId: fixtureId(`category:${category}`), conceptId, sourceType: 'FIXTURE' as const,
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
  return { concepts: 10, questions: 25, choices: 100, categories: 5 };
}
