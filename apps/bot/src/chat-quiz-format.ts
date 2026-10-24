import type { MessageEntity } from 'grammy/types';
import { parsePresentationSnapshot } from '../../../packages/database/src/presentation.ts';

export type QuizText = { text: string; entities: MessageEntity[] };
export type QuizTextOptions = { entities?: MessageEntity[]; link_preview_options?: { is_disabled: true } };
type Snapshot = ReturnType<typeof parsePresentationSnapshot>;

/** Telegram entity offsets count UTF-16 units. Clip ranges only at complete code points. */
export function richQuizChunks(content: QuizText): QuizText[] {
  const chunks: QuizText[] = [];
  let start = 0;
  while (start < content.text.length) {
    let end = Math.min(start + 4000, content.text.length);
    if (end < content.text.length && /[\uD800-\uDBFF]/u.test(content.text[end - 1]!)) end -= 1;
    const entities = content.entities.flatMap((entity) => {
      const left = Math.max(start, entity.offset);
      const right = Math.min(end, entity.offset + entity.length);
      return right > left ? [{ ...entity, offset: left - start, length: right - left }] : [];
    });
    chunks.push({ text: content.text.slice(start, end), entities });
    start = end;
  }
  return chunks;
}

function composer() {
  const content: QuizText = { text: '', entities: [] };
  const append = (text: string, type?: 'spoiler' | 'expandable_blockquote') => {
    if (content.text) content.text += '\n\n';
    const offset = content.text.length;
    content.text += text;
    if (type) content.entities.push({ type, offset, length: text.length });
  };
  const pair = (english: string | null, russian: string | null) => {
    if (english) append(english);
    if (russian) append(russian, 'spoiler');
  };
  return { content, append, pair };
}

/** The pre-answer card deliberately reads only the public question fields. */
export function bilingualQuizCard(snapshot: Snapshot): QuizText {
  const { content, pair } = composer();
  pair(snapshot.question.textEnglish, snapshot.question.textRussian);
  snapshot.question.choices.forEach((choice) => pair(`${choice.key}. ${choice.textEnglish}`, choice.textRussian));
  return content;
}

export function bilingualQuizFeedback(snapshot: Snapshot, isCorrect: boolean): QuizText {
  const { content, pair } = composer();
  const choice = snapshot.question.choices.find(({ id }) => id === snapshot.correctChoiceId)!;
  pair(isCorrect ? 'Correct' : 'Incorrect', isCorrect ? 'Верно' : 'Неверно');
  pair(`Correct answer: ${choice.key}. ${choice.textEnglish}`, `Правильный ответ: ${choice.key}. ${choice.textRussian}`);
  const explanationStart = content.text.length + 2;
  pair(snapshot.explanationEnglish, snapshot.explanationRussian);
  pair(snapshot.trapExplanationEnglish, snapshot.trapExplanationRussian);
  const teaching = snapshot.teaching!;
  pair(`Why the other choices are wrong\n${teaching.whyOthersWrongEnglish}`, `Почему другие ответы неверны\n${teaching.whyOthersWrongRussian}`);
  pair(`Practical safety reasoning\n${teaching.safetyReasonEnglish}`, `Практическая безопасность\n${teaching.safetyReasonRussian}`);
  pair(`DLT guidance\n${teaching.guidanceCitation}`, null);
  const statute = teaching.statute;
  if (statute) {
    pair(`Statutory source — unofficial English translation\n${statute.titleEnglish}\nSection ${statute.section}\n${statute.locator}\n${statute.url}\n${statute.excerptEnglish}\n${statute.summaryEnglish}`,
      `Источник закона — неофициальный перевод на английский\n${statute.titleRussian}\nРаздел ${statute.section}\n${statute.summaryRussian}`);
  }
  if (content.text.length > explanationStart) content.entities.unshift({ type: 'expandable_blockquote', offset: explanationStart, length: content.text.length - explanationStart });
  return content;
}

/** Legacy snapshots keep their complete stored-language feedback. */
export function quizFeedbackText(snapshot: Snapshot, isCorrect: boolean, language: 'ENGLISH' | 'RUSSIAN' | 'THAI'): QuizText {
  if (snapshot.teaching) return bilingualQuizFeedback(snapshot, isCorrect);
  const choice = snapshot.question.choices.find(({ id }) => id === snapshot.correctChoiceId)!;
  const wording = language === 'RUSSIAN' ? ['Верно', 'Неверно', 'Правильный ответ'] : language === 'THAI' ? ['ถูกต้อง', 'ไม่ถูกต้อง', 'คำตอบที่ถูกต้อง'] : ['Correct', 'Incorrect', 'Correct answer'];
  const answer = language === 'RUSSIAN' ? choice.textRussian : language === 'THAI' ? choice.textThai : choice.textEnglish;
  const explanation = language === 'RUSSIAN' ? snapshot.explanationRussian : language === 'THAI' ? snapshot.explanationThai : snapshot.explanationEnglish;
  const trap = language === 'RUSSIAN' ? snapshot.trapExplanationRussian : language === 'THAI' ? snapshot.trapExplanationThai : snapshot.trapExplanationEnglish;
  return { text: [wording[isCorrect ? 0 : 1], `${wording[2]}: ${choice.key}. ${answer}`, explanation, trap].filter(Boolean).join('\n\n'), entities: [] };
}
