import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../packages/database/src/index.ts';
import type { CandidateBatch } from './candidates.ts';

type CandidateQuestion = CandidateBatch['questions'][number];

export interface CandidateImportSummary {
  batchId: string;
  newQuestions: number;
  newChoices: number;
  matchedQuestions: number;
  matchedChoices: number;
  state: 'inactive DRAFT';
}

export function candidateQuestionId(version: 1, batchId: string, externalId: string): string {
  return candidateUuid(`thaidlt-candidate:v${version}:batch:${batchId}:question:${externalId}`);
}

export function candidateChoiceId(questionId: string, choiceKey: 'A' | 'B' | 'C' | 'D'): string {
  return candidateUuid(`thaidlt-candidate:choice:${questionId}:${choiceKey}`);
}

export function mapCandidateQuestion(
  batch: CandidateBatch,
  question: CandidateQuestion,
  categoryId: string,
  conceptId: string,
) {
  const id = candidateQuestionId(batch.version, batch.batchId, question.externalId);
  return {
    question: {
      id,
      vehicleType: question.vehicleType,
      categoryId,
      conceptId,
      textThai: question.textThai,
      textExamEnglish: question.textExamEnglish,
      textEnglish: question.textEnglish,
      textRussian: question.textRussian,
      explanationThai: question.explanationThai,
      explanationEnglish: question.explanationEnglish,
      explanationRussian: question.explanationRussian,
      trapExplanationThai: question.trapExplanationThai,
      trapExplanationEnglish: question.trapExplanationEnglish,
      trapExplanationRussian: question.trapExplanationRussian,
      imageReference: null,
      sourceType: question.source.type,
      sourceReference: question.source.reference,
      sourceDate: question.source.sourceDate === null
        ? null
        : new Date(`${question.source.sourceDate}T00:00:00.000Z`),
      legalCitation: question.source.legalCitation,
      verificationStatus: 'DRAFT' as const,
      reviewer: null,
      reviewedAt: null,
      active: false,
    },
    choices: question.choices.map((choice) => ({
      id: candidateChoiceId(id, choice.key),
      questionId: id,
      key: choice.key,
      textThai: choice.textThai,
      textEnglish: choice.textEnglish,
      textRussian: choice.textRussian,
      isCorrect: choice.key === question.correctChoiceKey,
    })),
  };
}

export async function importCandidateBatch(database: PrismaClient, batch: CandidateBatch): Promise<CandidateImportSummary> {
  return database.$transaction(async (transaction) => {
    const categorySlugs = [...new Set(batch.questions.map((question) => question.categorySlug))];
    const conceptSlugs = [...new Set(batch.questions.map((question) => question.conceptSlug))];
    const [categories, concepts] = await Promise.all([
      transaction.category.findMany({ where: { slug: { in: categorySlugs } }, select: { id: true, slug: true } }),
      transaction.concept.findMany({ where: { slug: { in: conceptSlugs } }, select: { id: true, slug: true } }),
    ]);
    if (categories.length !== categorySlugs.length || concepts.length !== conceptSlugs.length) {
      throw new Error('Candidate taxonomy reference is missing.');
    }
    const categoryIds = new Map(categories.map(({ id, slug }) => [slug, id]));
    const conceptIds = new Map(concepts.map(({ id, slug }) => [slug, id]));
    let newQuestions = 0;
    let newChoices = 0;
    let matchedQuestions = 0;
    let matchedChoices = 0;

    for (const candidate of batch.questions) {
      const categoryId = categoryIds.get(candidate.categorySlug);
      const conceptId = conceptIds.get(candidate.conceptSlug);
      if (categoryId === undefined || conceptId === undefined) throw new Error('Candidate taxonomy reference is missing.');
      const mapped = mapCandidateQuestion(batch, candidate, categoryId, conceptId);
      const existing = await transaction.question.findUnique({ where: { id: mapped.question.id }, include: { choices: true } });
      if (existing !== null) {
        if (!candidateContentMatches(existing, mapped)
          || existing.verificationStatus !== 'DRAFT'
          || existing.reviewer !== null
          || existing.reviewedAt !== null
          || existing.active) {
          throw new Error('Candidate identity collision.');
        }
        matchedQuestions += 1;
        matchedChoices += mapped.choices.length;
        continue;
      }
      const choiceCollision = await transaction.questionChoice.findFirst({
        where: { id: { in: mapped.choices.map(({ id }) => id) } },
        select: { id: true },
      });
      if (choiceCollision !== null) throw new Error('Candidate choice identity collision.');
      await transaction.question.create({
        data: {
          ...mapped.question,
          choices: { create: mapped.choices.map((choice) => ({
            id: choice.id,
            key: choice.key,
            textThai: choice.textThai,
            textEnglish: choice.textEnglish,
            textRussian: choice.textRussian,
            isCorrect: choice.isCorrect,
          })) },
        },
      });
      newQuestions += 1;
      newChoices += mapped.choices.length;
    }

    return {
      batchId: batch.batchId,
      newQuestions,
      newChoices,
      matchedQuestions,
      matchedChoices,
      state: 'inactive DRAFT',
    };
  }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 5000 });
}

function candidateUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function candidateContentMatches(
  existing: Prisma.QuestionGetPayload<{ include: { choices: true } }>,
  expected: ReturnType<typeof mapCandidateQuestion>,
): boolean {
  return questionContentMatches(existing, expected.question)
    && existing.choices.length === expected.choices.length
    && expected.choices.every((choice) => existing.choices.some((stored) => choiceMatches(stored, choice)));
}

function questionContentMatches(
  existing: Prisma.QuestionGetPayload<{ include: { choices: true } }>,
  expected: ReturnType<typeof mapCandidateQuestion>['question'],
): boolean {
  return existing.id === expected.id
    && existing.vehicleType === expected.vehicleType
    && existing.categoryId === expected.categoryId
    && existing.conceptId === expected.conceptId
    && existing.textThai === expected.textThai
    && existing.textExamEnglish === expected.textExamEnglish
    && existing.textEnglish === expected.textEnglish
    && existing.textRussian === expected.textRussian
    && existing.explanationThai === expected.explanationThai
    && existing.explanationEnglish === expected.explanationEnglish
    && existing.explanationRussian === expected.explanationRussian
    && existing.trapExplanationThai === expected.trapExplanationThai
    && existing.trapExplanationEnglish === expected.trapExplanationEnglish
    && existing.trapExplanationRussian === expected.trapExplanationRussian
    && existing.imageReference === null
    && existing.sourceType === expected.sourceType
    && existing.sourceReference === expected.sourceReference
    && datesEqual(existing.sourceDate, expected.sourceDate)
    && existing.legalCitation === expected.legalCitation;
}

function choiceMatches(
  existing: Prisma.QuestionChoiceGetPayload<object>,
  expected: ReturnType<typeof mapCandidateQuestion>['choices'][number],
): boolean {
  return existing.id === expected.id
    && existing.questionId === expected.questionId
    && existing.key === expected.key
    && existing.textThai === expected.textThai
    && existing.textEnglish === expected.textEnglish
    && existing.textRussian === expected.textRussian
    && existing.isCorrect === expected.isCorrect;
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}
