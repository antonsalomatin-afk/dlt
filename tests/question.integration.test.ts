import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChoiceKey, createDatabaseClient } from '../packages/database/src/index.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for real PostgreSQL integration tests.');
const database = createDatabaseClient(url);
const categoryId = randomUUID();
const conceptId = randomUUID();
const ownedQuestions: string[] = [];
let categoryCreated = false;
let conceptCreated = false;

beforeAll(async () => {
  await database.category.create({ data: { id: categoryId, slug: categoryId, nameThai: 'ทดสอบ', nameEnglish: 'Test', nameRussian: 'Тест' } });
  categoryCreated = true;
  await database.concept.create({ data: { id: conceptId, slug: conceptId, nameThai: 'ทดสอบ', nameEnglish: 'Test concept', nameRussian: 'Тест' } });
  conceptCreated = true;
});
afterAll(async () => {
  try {
    await database.question.deleteMany({ where: { id: { in: ownedQuestions } } });
    if (conceptCreated) await database.concept.delete({ where: { id: conceptId } });
    if (categoryCreated) await database.category.delete({ where: { id: categoryId } });
  } finally { await database.$disconnect(); }
});

describe('question domain constraints', () => {
  it('stores four multilingual choices, metadata and safe defaults; rejects duplicate keys and references', async () => {
    const question = await database.question.create({ data: {
      vehicleType: 'CAR', categoryId, conceptId,
      textThai: 'คำถามทดสอบ', textExamEnglish: 'Exam wording', textEnglish: 'Natural wording', textRussian: 'Тестовый вопрос',
      explanationEnglish: 'Synthetic test explanation', trapExplanationEnglish: 'Synthetic wording trap',
      sourceType: 'FIXTURE', sourceReference: 'test-only', sourceDate: new Date('2026-09-07'),
      legalCitation: 'Synthetic reference, not legal guidance', reviewer: 'Test reviewer', reviewedAt: new Date('2026-09-07'),
      choices: { create: Object.values(ChoiceKey).map((key) => ({ key, textThai: `คำตอบ ${key}`, textEnglish: `Choice ${key}`, textRussian: `Ответ ${key}`, isCorrect: key === 'A' })) },
    }, include: { choices: true, category: true, concept: true } });
    ownedQuestions.push(question.id);
    expect(question.choices).toHaveLength(4);
    expect(question.choices.filter((choice) => choice.isCorrect)).toHaveLength(1);
    expect(question).toMatchObject({ active: false, verificationStatus: 'DRAFT', textExamEnglish: 'Exam wording', textEnglish: 'Natural wording', imageReference: null });
    expect(question.category.nameRussian).toBe('Тест');
    expect(question.concept?.id).toBe(conceptId);
    await expect(database.questionChoice.create({ data: { questionId: question.id, key: 'A', textEnglish: 'Duplicate' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.questionChoice.create({ data: { questionId: randomUUID(), key: 'A', textEnglish: 'Orphan' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.question.update({ where: { id: question.id }, data: { categoryId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.question.update({ where: { id: question.id }, data: { conceptId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(database.category.delete({ where: { id: categoryId } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses to verify a question without original authorship and a legal citation', async () => {
    const base = {
      categoryId, vehicleType: 'CAR' as const, textEnglish: 'Provenance case',
      verificationStatus: 'VERIFIED' as const,
    };
    const citation = 'Land Traffic Act section 21';
    for (const data of [
      { ...base, sourceType: 'FIXTURE' as const, legalCitation: citation },
      { ...base, sourceType: 'OFFICIAL' as const, legalCitation: citation },
      { ...base, sourceType: 'THIRD_PARTY' as const, legalCitation: citation },
      { ...base, sourceType: 'ORIGINAL' as const },
      { ...base, sourceType: 'ORIGINAL' as const, legalCitation: null },
      { ...base, sourceType: 'ORIGINAL' as const, legalCitation: '' },
      { ...base, sourceType: 'ORIGINAL' as const, legalCitation: '   ' },
    ]) {
      await expect(database.question.create({ data }), JSON.stringify(data)).rejects.toThrow(/Question_verified_requires_(original|legal_citation)/u);
    }

    const accepted = await database.question.create({ data: { ...base, sourceType: 'ORIGINAL', legalCitation: citation } });
    ownedQuestions.push(accepted.id);
    expect(accepted).toMatchObject({ verificationStatus: 'VERIFIED', sourceType: 'ORIGINAL', legalCitation: citation });

    // Drafts may be incomplete: authoring and review happen before provenance is settled.
    // Each draft below violates exactly one rule, so the promotion failure is unambiguous.
    const uncitedDraft = await database.question.create({ data: {
      categoryId, vehicleType: 'CAR', textEnglish: 'Draft without a citation', sourceType: 'ORIGINAL',
    } });
    const borrowedDraft = await database.question.create({ data: {
      categoryId, vehicleType: 'CAR', textEnglish: 'Draft from elsewhere', sourceType: 'THIRD_PARTY', legalCitation: citation,
    } });
    ownedQuestions.push(uncitedDraft.id, borrowedDraft.id);
    expect(uncitedDraft).toMatchObject({ verificationStatus: 'DRAFT', legalCitation: null });
    await expect(database.question.update({ where: { id: uncitedDraft.id }, data: { verificationStatus: 'VERIFIED' } }))
      .rejects.toThrow(/Question_verified_requires_legal_citation/u);
    await expect(database.question.update({ where: { id: borrowedDraft.id }, data: { verificationStatus: 'VERIFIED' } }))
      .rejects.toThrow(/Question_verified_requires_original/u);
    await expect(database.question.update({ where: { id: uncitedDraft.id }, data: { verificationStatus: 'VERIFIED', legalCitation: citation } }))
      .resolves.toMatchObject({ verificationStatus: 'VERIFIED' });

    const constraints = await database.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conrelid = '"Question"'::regclass ORDER BY conname
    `;
    expect(constraints.map(({ conname }) => conname)).toEqual(expect.arrayContaining([
      'Question_verified_requires_original',
      'Question_verified_requires_legal_citation',
    ]));
  });

  it('selects only active verified questions for the requested vehicle and category', async () => {
    const cases = [
      { vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED' },
      { vehicleType: 'CAR', active: false, verificationStatus: 'VERIFIED' },
      { vehicleType: 'CAR', active: true, verificationStatus: 'DRAFT' },
      { vehicleType: 'MOTORCYCLE', active: true, verificationStatus: 'VERIFIED' },
    ] satisfies Array<{ vehicleType: 'CAR' | 'MOTORCYCLE'; active: boolean; verificationStatus: 'VERIFIED' | 'DRAFT' }>;
    let selectedId: string | undefined;
    for (const [index, state] of cases.entries()) {
      const question = await database.question.create({ data: { ...state, categoryId, textEnglish: 'Synthetic filter case', sourceType: 'ORIGINAL', legalCitation: 'Synthetic development citation, not legal guidance' } });
      ownedQuestions.push(question.id);
      if (index === 0) selectedId = question.id;
    }
    const selected = await database.question.findMany({ where: { vehicleType: 'CAR', categoryId, active: true, verificationStatus: 'VERIFIED' } });
    expect(selected.map(({ id }) => id)).toEqual([selectedId]);
    expect(await database.question.count({ where: { vehicleType: 'CAR', categoryId: randomUUID(), active: true, verificationStatus: 'VERIFIED' } })).toBe(0);
  });
});
