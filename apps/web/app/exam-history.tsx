'use client';

import { useEffect, useRef, useState } from 'react';
import {
  examHistoryResponseSchema,
  examReviewResponseSchema,
  type ExamHistoryItem,
  type ExamReview,
  type Session,
} from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
type ReviewError = 'unavailable' | 'incomplete' | 'generic' | null;

const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || 'Translation unavailable.';
const readableTime = (timestamp: string) => new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function exactError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (payload !== null && typeof payload === 'object' && Object.keys(payload).length === 1 && 'error' in payload && typeof payload.error === 'string') return payload.error;
  } catch { /* Use the safe fallback in the caller. */ }
  return '';
}

function olderThan(item: ExamHistoryItem, previous: ExamHistoryItem) {
  return item.startedAt < previous.startedAt || (item.startedAt === previous.startedAt && item.examId < previous.examId);
}

export function ExamHistory({ session, initialExamId, onBack, onExpired }: {
  session: Session;
  initialExamId: string | null;
  onBack: () => void;
  onExpired: () => void;
}) {
  const [items, setItems] = useState<ExamHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyPending, setHistoryPending] = useState(initialExamId === null);
  const [historyError, setHistoryError] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(initialExamId);
  const [review, setReview] = useState<ExamReview | null>(null);
  const [reviewPending, setReviewPending] = useState(initialExamId !== null);
  const [reviewError, setReviewError] = useState<ReviewError>(null);
  const [language, setLanguage] = useState<Language>('English');
  const active = useRef(true);
  const historyBusy = useRef(false);
  const reviewBusy = useRef(false);
  const reviewGeneration = useRef(0);
  const itemsRef = useRef<ExamHistoryItem[]>([]);
  const observedExamIds = useRef(new Set<string>());

  async function requestHistory(cursor: string | null) {
    if (!active.current || historyBusy.current) return;
    historyBusy.current = true; setHistoryPending(true); setHistoryError(false);
    try {
      const url = cursor === null ? '/exam/history?limit=10' : `/exam/history?limit=10&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!response.ok) throw new Error('History request failed');
      const payload: unknown = await response.json();
      if (!active.current) return;
      const page = examHistoryResponseSchema.parse(payload);
      const pageIds = new Set<string>();
      for (const item of page.items) {
        if (observedExamIds.current.has(item.examId) || pageIds.has(item.examId)) throw new Error('Duplicate exam');
        pageIds.add(item.examId);
      }
      const previous = itemsRef.current.at(-1);
      const first = page.items[0];
      if (cursor !== null && previous && first && !olderThan(first, previous)) throw new Error('Cross-page order is invalid');
      pageIds.forEach((id) => observedExamIds.current.add(id));
      const updated = cursor === null ? page.items : [...itemsRef.current, ...page.items];
      itemsRef.current = updated; setItems(updated); setNextCursor(page.nextCursor); setRetryCursor(null); setHistoryLoaded(true);
    } catch {
      if (active.current) { setHistoryError(true); setRetryCursor(cursor); }
    } finally {
      historyBusy.current = false;
      if (active.current) setHistoryPending(false);
    }
  }

  async function requestReview(examId: string) {
    if (!active.current || reviewBusy.current) return;
    const generation = ++reviewGeneration.current;
    reviewBusy.current = true; setReviewId(examId); setReview(null); setReviewPending(true); setReviewError(null);
    try {
      const response = await fetch(`/exam/${encodeURIComponent(examId)}/review`, {
        method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!active.current || generation !== reviewGeneration.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 404) { setReviewError('unavailable'); return; }
      if (response.status === 409) {
        const error = await exactError(response);
        if (!active.current || generation !== reviewGeneration.current) return;
        setReviewError(error === 'Exam not completed' ? 'incomplete' : 'generic');
        return;
      }
      if (!response.ok) throw new Error('Review request failed');
      const payload: unknown = await response.json();
      if (!active.current || generation !== reviewGeneration.current) return;
      const validated = examReviewResponseSchema.parse(payload);
      if (validated.examId !== examId) throw new Error('Review identity mismatch');
      setReview(validated);
    } catch {
      if (active.current && generation === reviewGeneration.current) setReviewError('generic');
    } finally {
      if (generation === reviewGeneration.current) {
        reviewBusy.current = false;
        if (active.current) setReviewPending(false);
      }
    }
  }

  useEffect(() => {
    active.current = true;
    if (initialExamId === null) void requestHistory(null);
    else void requestReview(initialExamId);
    return () => { active.current = false; reviewGeneration.current++; };
  }, []);

  function leave() { active.current = false; onBack(); }
  function backToHistory() {
    reviewGeneration.current++;
    reviewBusy.current = false;
    setReviewId(null); setReview(null); setReviewPending(false); setReviewError(null);
    if (!historyLoaded && !historyBusy.current) void requestHistory(null);
  }

  if (reviewId !== null) return <section className="panel exam-history" aria-labelledby="exam-review-title" aria-busy={reviewPending}>
    <p className="eyebrow accent">04 / EXAM REVIEW</p><h2 id="exam-review-title">Exam mistakes</h2>
    <button className="secondary" onClick={backToHistory}>Back to exam history</button>
    {reviewPending && <div className="message" role="status"><span aria-hidden="true">◌</span><p>Loading your exam review…</p></div>}
    {!reviewPending && reviewError && <><div className="message error" role="alert"><span aria-hidden="true">!</span><p>{reviewError === 'unavailable' ? 'This exam is unavailable.' : reviewError === 'incomplete' ? 'This exam is not completed yet.' : 'We could not load this exam review. Check your connection and retry.'}</p></div><button className="primary" onClick={() => void requestReview(reviewId)}>Retry review</button></>}
    {review && <>
      <div className={`exam-review-summary ${review.passed ? 'passed' : 'failed'}`} role="region" aria-label="Exam review summary"><strong>{review.passed ? 'Passed' : 'Not passed'}</strong><span>{review.score} / {review.questionCount}</span><time dateTime={review.completedAt}>{readableTime(review.completedAt)}</time></div>
      <fieldset className="languages"><legend>Review language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="exam-review-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
      {review.mistakes.length === 0 ? <div className="empty-history"><p>Perfect exam — there are no mistakes to review.</p></div> : <ol className="exam-mistake-list" aria-label="Exam mistakes">{review.mistakes.map((mistake) => <li key={mistake.examQuestionId}><article className="exam-mistake-card">
        <div className="exam-mistake-heading"><span>Question {mistake.position}</span><strong>{mistake.selectedChoiceId === null ? 'Unanswered' : 'Incorrect'}</strong></div>
        <h3>{localized(language, mistake.question.textEnglish, mistake.question.textRussian, mistake.question.textThai)}</h3>
        {mistake.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{mistake.question.textExamEnglish}</p></details>}
        <ul className="history-choices" aria-label={`Question ${mistake.position} choices`}>{mistake.question.choices.map((choice) => {
          const selected = choice.id === mistake.selectedChoiceId;
          const correct = choice.id === mistake.correctChoiceId;
          return <li className={`${selected ? 'selected' : ''} ${correct ? 'correct' : ''}`} key={choice.id}><span>{choice.key}. {localized(language, choice.textEnglish, choice.textRussian, choice.textThai)}</span>{(selected || correct) && <span className="choice-labels">{selected && <strong>Your answer</strong>}{correct && <strong>Correct answer</strong>}</span>}</li>;
        })}</ul>
        {mistake.answeredAt === null ? <p className="exam-answer-time">Your answer: Unanswered</p> : <time className="exam-answer-time" dateTime={mistake.answeredAt}>Answered {readableTime(mistake.answeredAt)}</time>}
        <div className="result" role="region" aria-label={`Question ${mistake.position} explanation`}><h4>Explanation</h4><p>{localized(language, mistake.explanationEnglish, mistake.explanationRussian, mistake.explanationThai)}</p><h4>Watch out for</h4><p>{localized(language, mistake.trapExplanationEnglish, mistake.trapExplanationRussian, mistake.trapExplanationThai)}</p></div>
      </article></li>)}</ol>}
    </>}
  </section>;

  return <section className="panel exam-history" aria-labelledby="exam-history-title" aria-busy={historyPending}>
    <p className="eyebrow accent">04 / COMPLETED EXAMS</p><h2 id="exam-history-title">Exam history</h2>
    <p className="panel-copy">Review completed mock-exam scores and study each exam’s saved mistakes.</p>
    <button className="secondary" onClick={leave}>Back</button>
    {historyPending && items.length === 0 && <div className="message" role="status"><span aria-hidden="true">◌</span><p>Loading your exam history…</p></div>}
    {!historyPending && !historyError && items.length === 0 && <div className="empty-history"><p>You have no completed mock exams yet.</p><button className="primary" onClick={leave}>Back</button></div>}
    {items.length > 0 && <ol className="exam-history-list" aria-label="Completed exams">{items.map((item) => <li key={item.examId}><article className="exam-history-entry">
      <div className="exam-history-heading"><span className={`history-outcome ${item.passed ? '' : 'exam-failed'}`}>{item.passed ? 'Passed' : 'Not passed'}</span><strong>{item.score} / {item.questionCount}</strong></div>
      <dl><div><dt>Vehicle</dt><dd>{item.vehicleType === 'CAR' ? 'Car' : 'Motorcycle'}</dd></div><div><dt>Answered</dt><dd>{item.answeredCount}</dd></div><div><dt>Unanswered</dt><dd>{item.unansweredCount}</dd></div></dl>
      <time dateTime={item.completedAt}>{readableTime(item.completedAt)}</time>
      <button className="secondary" onClick={() => void requestReview(item.examId)}>Review mistakes</button>
    </article></li>)}</ol>}
    {historyError && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>We could not load your exam history. Check your connection and retry.</p></div>}
    {historyError && <button className="primary" disabled={historyPending} onClick={() => void requestHistory(retryCursor)}>{historyPending ? 'Please wait…' : 'Retry exam history'}</button>}
    {!historyError && nextCursor !== null && <button className="primary next" disabled={historyPending} onClick={() => void requestHistory(nextCursor)}>{historyPending ? 'Loading more…' : 'Load more exams'}</button>}
  </section>;
}
