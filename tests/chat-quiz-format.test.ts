import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { validateTeachingInputs } from '../packages/database/src/teaching.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import { mapCandidateQuestion } from '../tools/content/candidate-import.ts';
import { buildNativeQuiz } from '../apps/bot/src/chat-quiz.ts';
import { bilingualQuizCard, bilingualQuizFeedback, richQuizChunks, type QuizText } from '../apps/bot/src/chat-quiz-format.ts';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as unknown;
const inputs = validateTeachingInputs({
  pack: read('content/imports/launch-20261023-bilingual-teaching.json'), review: read('.agent/reviews/TASK-084-content-review-01.json'),
  car: read('content/imports/launch-20261016-car-candidates.json'), motorcycle: read('content/imports/launch-20261016-motorcycle-candidates.json'),
  stems: read('content/imports/launch-20261021-russian-stems.json'),
});
function snapshot(batch = inputs.car, index = 0) {
  const mapped = mapCandidateQuestion(batch, batch.questions[index]!, randomUUID(), randomUUID());
  const entry = inputs.pack.entries.find((item) => item.batchId === batch.batchId && item.externalId === batch.questions[index]!.externalId)!;
  return snapshotQuestion({ ...mapped.question, active: true, verificationStatus: 'VERIFIED', textRussian: entry.textRussian, createdAt: new Date(), updatedAt: new Date(), choices: mapped.choices }, { reviewedTeaching: true });
}
function covered(content: QuizText, type = 'spoiler') {
  return content.entities.filter((entity) => entity.type === type).map((entity) => content.text.slice(entity.offset, entity.offset + entity.length));
}

it('renders every accepted question and all 400 Russian choices with exact immutable poll mapping and no teaching leak', () => {
  let questions = 0; let choices = 0;
  for (const batch of [inputs.car, inputs.motorcycle]) for (let index = 0; index < 50; index += 1) {
    const stored = snapshot(batch, index);
    const card = bilingualQuizCard(stored);
    expect(covered(card)).toEqual([stored.question.textRussian, ...stored.question.choices.map(({ textRussian }) => textRussian)]);
    expect(card.text).toBe([stored.question.textEnglish, stored.question.textRussian, ...stored.question.choices.flatMap((choice) => [`${choice.key}. ${choice.textEnglish}`, choice.textRussian])].join('\n\n'));
    for (const language of ['ENGLISH', 'RUSSIAN', 'THAI'] as const) {
      const quiz = buildNativeQuiz(stored, language);
      expect(quiz.question).toBe('Choose the correct answer.');
      expect(quiz.options.map(({ text }) => text)).toEqual(stored.question.choices.map(({ key }) => key));
      expect(quiz.other).toEqual({ type: 'quiz', is_anonymous: false, correct_option_ids: [stored.question.choices.findIndex(({ id }) => id === stored.correctChoiceId)], allows_multiple_answers: false, allows_revoting: false, shuffle_options: false, allow_adding_options: false });
      expect(quiz.card).toEqual(card);
    }
    const feedback = bilingualQuizFeedback(stored, false);
    for (const value of [stored.explanationEnglish, stored.explanationRussian, stored.teaching!.whyOthersWrongEnglish, stored.teaching!.whyOthersWrongRussian, stored.teaching!.safetyReasonEnglish, stored.teaching!.safetyReasonRussian, stored.teaching!.guidanceCitation]) expect(feedback.text).toContain(value);
    expect(feedback.text).toContain('DLT guidance');
    expect(covered(feedback)).toContain(stored.explanationRussian);
    expect(feedback.entities.some(({ type }) => type === 'expandable_blockquote')).toBe(true);
    if (stored.teaching!.statute) {
      const statute = stored.teaching!.statute;
      for (const value of [statute.titleEnglish, statute.titleRussian, statute.section, statute.locator, statute.url, statute.excerptEnglish, statute.summaryEnglish, statute.summaryRussian, 'unofficial English translation']) expect(feedback.text).toContain(value);
    } else expect(feedback.text).not.toContain('Statutory source');
    questions += 1; choices += stored.question.choices.length;
  }
  expect({ questions, choices }).toEqual({ questions: 100, choices: 400 });
});

it('preserves literal markup and every UTF-16 entity range through long Unicode chunks', () => {
  const stored = snapshot();
  stored.question.textEnglish = '<b>literal</b> & [not a link](javascript:x) 😀';
  stored.question.textRussian = `Русский ${'я😀'.repeat(5000)} <spoiler>literal</spoiler>`;
  const original = bilingualQuizCard(stored);
  const chunks = richQuizChunks(original);
  expect(chunks.map(({ text }) => text).join('')).toBe(original.text);
  expect(chunks.length).toBeGreaterThan(3);
  const recovered: Array<{ offset: number; length: number; type: string }> = [];
  let base = 0;
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(4000);
    expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    for (const entity of chunk.entities) {
      expect(entity.offset).toBeGreaterThanOrEqual(0);
      expect(entity.offset + entity.length).toBeLessThanOrEqual(chunk.text.length);
      recovered.push({ ...entity, offset: base + entity.offset });
    }
    base += chunk.text.length;
  }
  for (const entity of original.entities) {
    expect(recovered.filter(({ type, offset }) => type === entity.type && offset >= entity.offset && offset < entity.offset + entity.length).map(({ offset, length }) => original.text.slice(offset, offset + length)).join('')).toBe(original.text.slice(entity.offset, entity.offset + entity.length));
  }
  const feedback = bilingualQuizFeedback(stored, true);
  feedback.text += '😀'.repeat(8000);
  feedback.entities.push({ type: 'spoiler', offset: feedback.text.length - 16000, length: 16000 });
  const full = richQuizChunks(feedback);
  expect(full.map(({ text }) => text).join('')).toBe(feedback.text);
  expect(full.flatMap((chunk) => covered(chunk)).join('')).toContain('😀'.repeat(8000));
  expect(richQuizChunks({ text: '', entities: [] })).toEqual([]);
});
