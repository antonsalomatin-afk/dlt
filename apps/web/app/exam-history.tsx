'use client';

import { useEffect, useRef, useState } from 'react';
import { examHistoryResponseSchema, examResultSchema, type ExamHistoryItem, type ExamResult, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || null;
const readableTime = (value: string) => new Date(value).toLocaleString();
const statusLabel: Record<ExamHistoryItem['status'], string> = { IN_PROGRESS: 'In progress', EXPIRED: 'Expired', COMPLETED: 'Completed' };
const vehicleLabel = { CAR: 'Car', MOTORCYCLE: 'Motorcycle' } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function ExamHistory({ session, onBack, onExpired }: { session: Session; onBack: () => void; onExpired: () => void }) {
  const [items, setItems] = useState<ExamHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('English');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const [review, setReview] = useState<ExamResult | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);

  async function request(cursor: string | null) {
    if (busy.current || !active.current) return;
    busy.current = true; setPending(true); setError(false);
    try {
      const query = cursor === null ? '/exam/history?limit=10' : `/exam/history?limit=10&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(query, { method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const page = examHistoryResponseSchema.parse(payload);
      const known = new Set(items.map((item) => item.examId));
      for (const item of page.items) {
        if (known.has(item.examId)) throw new Error();
        known.add(item.examId);
      }
      setItems((current) => cursor === null ? page.items : [...current, ...page.items]);
      setNextCursor(page.nextCursor); setRetryCursor(null);
    } catch {
      if (active.current) { setError(true); setRetryCursor(cursor); }
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }

  async function open(examId: string) {
    if (busy.current || !active.current || !uuidPattern.test(examId)) return;
    busy.current = true; setPending(true); setReviewing(examId); setReviewError(null); setReview(null);
    try {
      const response = await fetch(`/exam/${examId}/result`, { method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 409) { setReviewError('This exam is not finished yet, so there is no result to review.'); return; }
      if (response.status === 404) { setReviewError('This exam is no longer available.'); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const result = examResultSchema.parse(payload);
      if (result.examId !== examId) throw new Error();
      setReview(result);
    } catch {
      if (active.current) setReviewError('We could not load this exam review. Check your connection and retry.');
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }

  useEffect(() => {
    active.current = true;
    void request(null);
    return () => { active.current = false; };
  }, []);

  const leave = () => { active.current = false; onBack(); };
  const closeReview = () => { if (pending) return; setReview(null); setReviewing(null); setReviewError(null); };

  if (reviewing !== null) {
    return <section className="panel history exam-review" aria-labelledby="exam-review-title" aria-busy={pending}>
      <p className="eyebrow accent">05 / EXAM REVIEW</p>
      <h2 id="exam-review-title">Exam review</h2>
      <button className="secondary" onClick={closeReview} disabled={pending}>Back to exam history</button>
      <fieldset className="languages"><legend>Review language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="exam-review-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
      {pending && <div className="message" role="status"><span aria-hidden="true">◌</span><p>Loading your exam review…</p></div>}
      {review && <>
        <dl className="progress-summary" aria-label="Exam result">
          <div className="progress-metric"><dt>Score</dt><dd>{review.score} / {review.questionCount}</dd></div>
          <div className="progress-metric"><dt>Pass mark</dt><dd>{review.passingScore}</dd></div>
          <div className="progress-metric"><dt>Answered</dt><dd>{review.answeredCount}</dd></div>
          <div className="progress-metric"><dt>Unanswered</dt><dd>{review.unansweredCount}</dd></div>
          <div className={`progress-metric exam-outcome ${review.passed ? 'passed' : 'failed'}`}><dt>Result</dt><dd>{review.passed ? 'Passed' : 'Not passed'}</dd></div>
        </dl>
        <p className="panel-copy"><time dateTime={review.completedAt}>Completed {readableTime(review.completedAt)}</time> · {vehicleLabel[review.vehicleType]}</p>
        <div className="history-list">{review.questions.map((row) => <details className={`history-entry ${row.isCorrect === null ? 'unanswered' : row.isCorrect ? 'correct' : 'incorrect'}`} key={row.examQuestionId}>
          <summary>
            <span className="history-outcome">{row.isCorrect === null ? 'Unanswered' : row.isCorrect ? 'Correct' : 'Incorrect'}</span>
            <span>{row.position}. {localized(language, row.question.textEnglish, row.question.textRussian, row.question.textThai)}</span>
          </summary>
          <div className="history-details">
            <h3>{localized(language, row.question.textEnglish, row.question.textRussian, row.question.textThai)}</h3>
            {row.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{row.question.textExamEnglish}</p></details>}
            <ul className="history-choices" aria-label={`Question ${row.position} choices`}>{row.question.choices.map((choice) => {
              const selected = choice.id === row.selectedChoiceId;
              const correct = choice.id === row.correctChoiceId;
              return <li className={`${selected ? 'selected' : ''} ${correct ? 'correct' : ''}`} key={choice.id}>
                <span>{choice.key}. {localized(language, choice.textEnglish, choice.textRussian, choice.textThai)}</span>
                {(selected || correct) && <span className="choice-labels">{selected && <strong>Your answer</strong>}{correct && <strong>Correct answer</strong>}</span>}
              </li>;
            })}</ul>
            <div className="result" role="region" aria-label={`Question ${row.position} explanation`}>
              <h4>Explanation</h4><p>{localized(language, row.explanationEnglish, row.explanationRussian, row.explanationThai) ?? 'Explanation unavailable.'}</p>
              <h4>Watch out for</h4><p>{localized(language, row.trapExplanationEnglish, row.trapExplanationRussian, row.trapExplanationThai) ?? 'Trap explanation unavailable.'}</p>
            </div>
          </div>
        </details>)}</div>
      </>}
      {reviewError && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>{reviewError}</p></div>}
      {reviewError && <button className="primary" disabled={pending} onClick={() => void open(reviewing)}>{pending ? 'Please wait…' : 'Retry review'}</button>}
    </section>;
  }

  return <section className="panel history exam-history" aria-labelledby="exam-history-title" aria-busy={pending}>
    <p className="eyebrow accent">05 / EXAM HISTORY</p>
    <h2 id="exam-history-title">Exam history</h2>
    <p className="panel-copy">Every mock exam you have started, newest first. Open a completed exam to review each question.</p>
    <button className="secondary" onClick={leave}>Back</button>
    {pending && items.length === 0 && <div className="message" role="status"><span aria-hidden="true">◌</span><p>Loading your exams…</p></div>}
    {!pending && !error && items.length === 0 && <div className="empty-history"><p>No mock exams yet. Start one when you feel ready.</p><button className="primary" onClick={leave}>Back</button></div>}
    {items.length > 0 && <ul className="exam-list" aria-label="Mock exams">{items.map((item) => <li className={`exam-item ${item.status.toLowerCase()} ${item.passed === null ? '' : item.passed ? 'passed' : 'failed'}`} key={item.examId}>
      <div className="exam-item-head">
        <span className="history-outcome">{item.status === 'COMPLETED' ? (item.passed ? 'Passed' : 'Not passed') : statusLabel[item.status]}</span>
        <time dateTime={item.startedAt}>{readableTime(item.startedAt)}</time>
      </div>
      <p className="exam-item-copy">{vehicleLabel[item.vehicleType]} · {item.status === 'COMPLETED' && item.score !== null ? `Score ${item.score} / ${item.questionCount}` : `Answered ${item.answeredCount} / ${item.questionCount}`} · Pass mark {item.passingScore}</p>
      {item.status === 'COMPLETED' && <button className="secondary" disabled={pending} onClick={() => void open(item.examId)}>Review exam</button>}
    </li>)}</ul>}
    {error && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>We could not load your exams. Check your connection and retry.</p></div>}
    {error && <button className="primary" disabled={pending} onClick={() => void request(retryCursor)}>{pending ? 'Please wait…' : 'Retry exams'}</button>}
    {!error && nextCursor !== null && <button className="primary next" disabled={pending} onClick={() => void request(nextCursor)}>{pending ? 'Loading more…' : 'Load more'}</button>}
  </section>;
}
