import { z } from 'zod';

export const MAX_CANDIDATE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CANDIDATE_DIAGNOSTICS = 20;

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const internalReferencePattern = /^internal:[a-z0-9]+(?:[./:_-][a-z0-9]+)*$/;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function normalizedString(maximum: number) {
  return z.string()
    .min(1, 'must not be blank.')
    .max(maximum, `must contain at most ${maximum} characters.`)
    .refine((value) => value === value.trim(), 'must not have surrounding whitespace.');
}

const key = normalizedString(64).regex(keyPattern, 'must be a lowercase human-readable key.');
const taxonomySlug = normalizedString(64).regex(keyPattern, 'must be a lowercase taxonomy slug.');
const text = normalizedString(4000);
const nullableText = text.nullable();
const reference = normalizedString(2048);
const canonicalInstant = normalizedString(24).refine((value) => {
  if (!canonicalInstantPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}, 'must be a canonical ISO UTC timestamp.');
const canonicalDate = normalizedString(10).refine((value) => {
  if (!canonicalDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'must be a canonical calendar date.');

const sourceSchema = z.strictObject({
  type: z.enum(['ORIGINAL', 'OFFICIAL', 'THIRD_PARTY']),
  reference,
  sourceDate: canonicalDate.nullable(),
  legalCitation: nullableText,
}).superRefine((source, context) => {
  if (source.type === 'ORIGINAL') {
    if (!internalReferencePattern.test(source.reference)) {
      context.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'must be a traceable internal: reference for ORIGINAL material.',
      });
    }
    return;
  }
  if (source.sourceDate === null) {
    context.addIssue({
      code: 'custom',
      path: ['sourceDate'],
      message: 'is required for cited material.',
    });
  }
  if (source.legalCitation === null) {
    context.addIssue({
      code: 'custom',
      path: ['legalCitation'],
      message: 'is required for cited material.',
    });
  }
});

const choiceSchema = z.strictObject({
  key: z.enum(['A', 'B', 'C', 'D']),
  textThai: nullableText,
  textEnglish: text,
  textRussian: nullableText,
});

const questionSchema = z.strictObject({
  externalId: key,
  vehicleType: z.enum(['CAR', 'MOTORCYCLE']),
  categorySlug: taxonomySlug,
  conceptSlug: taxonomySlug,
  source: sourceSchema,
  textThai: nullableText,
  textExamEnglish: nullableText,
  textEnglish: text,
  textRussian: nullableText,
  explanationThai: nullableText,
  explanationEnglish: nullableText,
  explanationRussian: nullableText,
  trapExplanationThai: nullableText,
  trapExplanationEnglish: nullableText,
  trapExplanationRussian: nullableText,
  choices: z.array(choiceSchema).length(4, 'must contain exactly four choices.'),
  correctChoiceKey: z.enum(['A', 'B', 'C', 'D']),
}).superRefine((question, context) => {
  const choiceKeys = new Set(question.choices.map((choice) => choice.key));
  if (choiceKeys.size !== 4) {
    context.addIssue({
      code: 'custom',
      path: ['choices'],
      message: 'must contain choice keys A through D exactly once.',
    });
  }
  if (!choiceKeys.has(question.correctChoiceKey)) {
    context.addIssue({
      code: 'custom',
      path: ['correctChoiceKey'],
      message: 'must identify a supplied choice.',
    });
  }
  for (const field of ['textThai', 'textEnglish', 'textRussian'] as const) {
    const seen = new Set<string>();
    for (const [index, choice] of question.choices.entries()) {
      const value = choice[field];
      if (value === null) continue;
      const normalized = normalizeWording(value);
      if (seen.has(normalized)) {
        context.addIssue({
          code: 'custom',
          path: ['choices', index, field],
          message: `duplicates normalized ${field} choice wording.`,
        });
      }
      seen.add(normalized);
    }
  }
});

export const candidateBatchSchema = z.strictObject({
  batchId: key,
  version: z.literal(1),
  createdAt: canonicalInstant,
  questions: z.array(questionSchema)
    .min(1, 'must contain at least one question.')
    .max(500, 'must contain at most 500 questions.'),
}).superRefine((batch, context) => {
  const externalIds = new Set<string>();
  const wordingByField = new Map<string, Set<string>>();
  for (const [index, question] of batch.questions.entries()) {
    if (externalIds.has(question.externalId)) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'externalId'],
        message: 'duplicates another question externalId.',
      });
    }
    externalIds.add(question.externalId);

    for (const field of ['textThai', 'textExamEnglish', 'textEnglish', 'textRussian'] as const) {
      const value = question[field];
      if (value === null) continue;
      const normalized = normalizeWording(value);
      const seen = wordingByField.get(field) ?? new Set<string>();
      if (seen.has(normalized)) {
        context.addIssue({
          code: 'custom',
          path: ['questions', index, field],
          message: `duplicates normalized ${field} question wording.`,
        });
      }
      seen.add(normalized);
      wordingByField.set(field, seen);
    }
  }
});

export type CandidateBatch = z.infer<typeof candidateBatchSchema>;

export interface CandidateBatchSummary {
  batchId: string;
  version: 1;
  questions: number;
  choices: number;
}

export function parseCandidateBatch(input: unknown): CandidateBatch {
  return candidateBatchSchema.parse(input);
}

export function summarizeCandidateBatch(batch: CandidateBatch): CandidateBatchSummary {
  return {
    batchId: batch.batchId,
    version: batch.version,
    questions: batch.questions.length,
    choices: batch.questions.reduce((count, question) => count + question.choices.length, 0),
  };
}

export function formatCandidateDiagnostics(error: z.ZodError): string[] {
  return error.issues.slice(0, MAX_CANDIDATE_DIAGNOSTICS).map((issue) => {
    const path = issue.path.reduce<string>((result, member) => (
      typeof member === 'number' ? `${result}[${member}]` : `${result}.${String(member)}`
    ), '$');
    const message = issue.code === 'custom'
      ? issue.message
      : issue.code === 'unrecognized_keys'
        ? 'contains unknown fields.'
        : issue.code === 'too_small' || issue.code === 'too_big'
          ? issue.message
          : 'has an invalid value or type.';
    return `${path}: ${message}`.slice(0, 240);
  });
}

function normalizeWording(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}
