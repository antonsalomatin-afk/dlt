'use client';

import { useEffect, useRef, useState } from 'react';
import {
  historyResponseSchema,
  mistakesResponseSchema,
  presentationSchema,
  retryMistakeErrorSchema,
  type HistoryItem,
  type Presentation,
  type Session,
} from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';

const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || null;

function readableTime(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

type FeedKind = 'history' | 'mistakes';

const feedCopy = {
  history: {
    endpoint: '/me/history', eyebrow: '03 / YOUR ANSWERS', title: 'Answer history', language: 'History language',
    loading: 'Loading your answer history…',
    empty: 'You have not submitted any answers yet. Start practicing when you are ready.',
    error: 'We could not load your answer history. Check your connection and retry.', retry: 'Retry history',
  },
  mistakes: {
    endpoint: '/me/mistakes', eyebrow: '03 / LEARN FROM MISTAKES', title: 'Mistakes to review', language: 'Mistakes language',
    loading: 'Loading your incorrect submitted answers…',
    empty: 'You have no incorrect submitted answers to review yet. Keep practicing and check back after a mistake.',
    error: 'We could not load your incorrect submitted answers. Check your connection and retry.', retry: 'Retry mistakes',
  },
} as const satisfies Record<FeedKind, {
  endpoint: string; eyebrow: string; title: string; language: string; loading: string; empty: string; error: string; retry: string;
}>;

export function History({ session, onBack, onExpired, onPractice, onVehicle, kind = 'history' }: {
  session: Session;
  onBack: () => void;
  onExpired: () => void;
  onPractice?: ((presentation: Presentation) => void) | undefined;
  onVehicle?: (() => void) | undefined;
  kind?: FeedKind;
}) {
  const copy = feedCopy[kind];
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('English');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const [retryingPresentationId, setRetryingPresentationId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const active = useRef(true);

  async function request(cursor: string | null) {
    if (busy.current || !active.current) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      const query = cursor === null ? `${copy.endpoint}?limit=10` : `${copy.endpoint}?limit=10&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(query, {
        method: 'GET', headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const page = (kind === 'mistakes' ? mistakesResponseSchema : historyResponseSchema).parse(payload);
      const accumulatedIds = new Set(items.map((item) => item.presentationId));
      for (const item of page.items) {
        if (accumulatedIds.has(item.presentationId)) throw new Error();
        accumulatedIds.add(item.presentationId);
      }
      setItems((current) => cursor === null ? page.items : [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setRetryCursor(null);
    } catch {
      if (active.current) { setError(true); setRetryCursor(cursor); }
    } finally {
      if (active.current) { busy.current = false; setPending(false); }
    }
  }

  async function retryMistake(presentationId: string) {
    if (kind !== 'mistakes' || busy.current || !active.current || !onPractice) return;
    busy.current = true;
    setRetryingPresentationId(presentationId);
    setRetryErrors((current) => ({ ...current, [presentationId]: '' }));
    try {
      const response = await fetch('/practice/retry-mistake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ presentationId }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (!response.ok) {
        const parsed = retryMistakeErrorSchema.parse(await response.json());
        if (!active.current) return;
        if (response.status === 401 && parsed.error === 'Unauthorized') {
          active.current = false;
          onExpired();
          return;
        }
        if (response.status === 409 && parsed.error === 'Vehicle selection required' && onVehicle) {
          active.current = false;
          onVehicle();
          return;
        }
        if (response.status === 409 && parsed.error === 'Mistake has no concept') {
          setRetryErrors((current) => ({ ...current, [presentationId]: 'This mistake is not linked to a practice concept.' }));
          return;
        }
        if (response.status === 404 && parsed.error === 'Mistake not found') {
          setRetryErrors((current) => ({ ...current, [presentationId]: 'This mistake is no longer available. Review another mistake.' }));
          return;
        }
        if (response.status === 404 && parsed.error === 'No questions available') {
          setRetryErrors((current) => ({ ...current, [presentationId]: 'No practice questions are available for this concept right now. Try again later.' }));
          return;
        }
        throw new Error();
      }
      const payload: unknown = await response.json();
      if (!active.current) return;
      const presentation = presentationSchema.parse(payload);
      active.current = false;
      onPractice(presentation);
    } catch {
      if (active.current) {
        setRetryErrors((current) => ({ ...current, [presentationId]: 'We could not start concept practice. Check your connection and retry.' }));
      }
    } finally {
      if (active.current) {
        busy.current = false;
        setRetryingPresentationId(null);
      }
    }
  }

  useEffect(() => {
    active.current = true;
    void request(null);
    return () => { active.current = false; };
  }, []);

  const leave = () => { active.current = false; onBack(); };

  return <section className="panel history" aria-labelledby={`${kind}-title`} aria-busy={pending}>
    <p className="eyebrow accent">{copy.eyebrow}</p>
    <h2 id={`${kind}-title`}>{copy.title}</h2>
    {kind === 'mistakes' && <p className="panel-copy">Review each incorrect submitted answer as its own attempt. Later answers do not change this list.</p>}
    <button className="secondary" onClick={leave}>Back</button>
    <fieldset className="languages" disabled={retryingPresentationId !== null}><legend>{copy.language}</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name={`${kind}-language`} checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    {pending && items.length === 0 && <div className="message" role="status"><span aria-hidden="true">◌</span><p>{copy.loading}</p></div>}
    {!pending && !error && items.length === 0 && <div className="empty-history"><p>{copy.empty}</p><button className="primary" onClick={leave}>Back</button></div>}
    {items.length > 0 && <div className="history-list">{items.map((item) => <details className={`history-entry ${item.isCorrect ? 'correct' : 'incorrect'}`} key={item.presentationId}>
      <summary>
        <span className="history-outcome">{item.isCorrect ? 'Correct' : 'Incorrect'}</span>
        <span>{localized(language, item.question.textEnglish, item.question.textRussian, item.question.textThai)}</span>
        <time dateTime={item.submittedAt}>{readableTime(item.submittedAt)}</time>
      </summary>
      <div className="history-details">
        <h3>{localized(language, item.question.textEnglish, item.question.textRussian, item.question.textThai)}</h3>
        {item.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{item.question.textExamEnglish}</p></details>}
        <ul className="history-choices" aria-label="Submitted answer choices">{item.question.choices.map((choice) => {
          const selected = choice.id === item.selectedChoiceId;
          const correct = choice.id === item.correctChoiceId;
          return <li className={`${selected ? 'selected' : ''} ${correct ? 'correct' : ''}`} key={choice.id}>
            <span>{choice.key}. {localized(language, choice.textEnglish, choice.textRussian, choice.textThai)}</span>
            {(selected || correct) && <span className="choice-labels">{selected && <strong>Your answer</strong>}{correct && <strong>Correct answer</strong>}</span>}
          </li>;
        })}</ul>
        <div className="result" role="region" aria-label="Historical answer explanation">
          <h4>Explanation</h4><p>{localized(language, item.explanationEnglish, item.explanationRussian, item.explanationThai) ?? 'Explanation unavailable.'}</p>
          <h4>Watch out for</h4><p>{localized(language, item.trapExplanationEnglish, item.trapExplanationRussian, item.trapExplanationThai) ?? 'Trap explanation unavailable.'}</p>
        </div>
        {kind === 'mistakes' && <div className="mistake-retry">
          <button className="primary" disabled={retryingPresentationId !== null || pending} onClick={() => void retryMistake(item.presentationId)}>
            {retryingPresentationId === item.presentationId ? 'Starting concept practice…' : 'Practice this concept'}
          </button>
          {retryErrors[item.presentationId] && <p className="message error" role="alert">{retryErrors[item.presentationId]}</p>}
        </div>}
      </div>
    </details>)}</div>}
    {error && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>{copy.error}</p></div>}
    {error && <button className="primary" disabled={pending || retryingPresentationId !== null} onClick={() => void request(retryCursor)}>{pending ? 'Please wait…' : copy.retry}</button>}
    {!error && nextCursor !== null && <button className="primary next" disabled={pending || retryingPresentationId !== null} onClick={() => void request(nextCursor)}>{pending ? 'Loading more…' : 'Load more'}</button>}
  </section>;
}
