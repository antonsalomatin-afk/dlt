'use client';

import { AppMenu } from './app-menu';
import { useEffect, useRef, useState } from 'react';
import {
  answerSchema,
  dailyPracticeResponseSchema,
  type Answer,
  type DailyPractice,
  type Session,
} from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
type LoadState = 'loading' | 'ready' | 'complete' | 'empty' | 'error';

const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || null;

export function Daily({ linkedPresentationId, session, onSetup, onPractice, onHistory, onVehicle, onExpired }: {
  linkedPresentationId?: string | undefined;
  session: Session;
  onSetup: () => void;
  onPractice: () => void;
  onHistory: () => void;
  onVehicle: () => void;
  onExpired: () => void;
}) {
  const linked = linkedPresentationId !== undefined;
  const [daily, setDaily] = useState<DailyPractice | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [language, setLanguage] = useState<Language>('English');
  const [choice, setChoice] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [message, setMessage] = useState('Loading today’s question…');
  const [answerPending, setAnswerPending] = useState(false);
  const [answerError, setAnswerError] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(true);
  const loadBusy = useRef(false);
  const answerBusy = useRef(false);
  const requestId = useRef(0);

  async function loadDaily() {
    if (loadBusy.current || answerBusy.current || !mounted.current) return;
    const id = ++requestId.current;
    loadBusy.current = true;
    setLoadState('loading'); setDaily(null); setChoice(null); setAnswer(null);
    setAttempted(false); setAnswerError(false); setMessage('Loading today’s question…');
    try {
      if (linkedPresentationId === 'invalid') {
        setLoadState('empty'); setMessage('This question link is invalid. Open History or continue with ordinary practice.'); return;
      }
      const response = await fetch(linked ? '/practice/presentation' : '/practice/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(linked ? { presentationId: linkedPresentationId } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!mounted.current || id !== requestId.current) return;
      if (response.status === 401) { mounted.current = false; requestId.current++; onExpired(); return; }
      if (response.status === 409) { mounted.current = false; requestId.current++; onVehicle(); return; }
      if (response.status === 404) {
        setLoadState('empty');
        setMessage(linked ? 'This question link is unavailable. Open History or continue with ordinary practice.' : 'No question is available for your vehicle today. You can retry or use ordinary practice.');
        return;
      }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!mounted.current || id !== requestId.current) return;
      const result = dailyPracticeResponseSchema.parse(payload);
      if (linked && result.presentationId !== linkedPresentationId) throw new Error();
      setDaily(result);
      setLoadState(result.answered ? 'complete' : 'ready');
      setMessage(result.answered ? (linked ? 'This question is complete. Open History to review your saved result.' : 'Today’s question is complete.') : linked ? 'Choose one answer, then check your answer.' : 'Choose one answer, then submit.');
    } catch {
      if (mounted.current && id === requestId.current) {
        setLoadState('error');
        setMessage(linked ? 'We could not load this question. Check your connection and retry.' : 'We could not load today’s question. Check your connection and retry.');
      }
    } finally {
      if (id === requestId.current) loadBusy.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    void loadDaily();
    return () => { mounted.current = false; requestId.current++; };
  }, []);

  function leave(action: () => void) {
    mounted.current = false;
    requestId.current++;
    action();
  }

  function selectChoice(id: string) {
    if (!answerBusy.current && loadState === 'ready' && !answer) setChoice(id);
  }

  async function submitAnswer() {
    if (answerBusy.current || loadBusy.current || !mounted.current || loadState !== 'ready' || !daily || !choice || answer) return;
    const id = ++requestId.current;
    const presentationId = daily.presentationId;
    const selectedChoiceId = choice;
    answerBusy.current = true;
    setAnswerPending(true); setAnswerError(false); setAttempted(true); setMessage('Checking your answer…');
    try {
      const response = await fetch('/practice/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ presentationId, choiceId: selectedChoiceId }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!mounted.current || id !== requestId.current) return;
      if (response.status === 401) { mounted.current = false; requestId.current++; onExpired(); return; }
      if (response.status === 409) {
        setChoice(null); setLoadState('complete');
        setMessage('Today’s answer was already submitted. Open History to review saved results.');
        return;
      }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!mounted.current || id !== requestId.current) return;
      const result = answerSchema.parse(payload);
      if (result.presentationId !== presentationId || result.selectedChoiceId !== selectedChoiceId
        || !daily.question.choices.some(({ id: choiceId }) => choiceId === result.correctChoiceId)
        || result.isCorrect !== (result.selectedChoiceId === result.correctChoiceId)) throw new Error();
      setAnswer(result);
      setMessage('Answer saved. Take a moment to understand the rule.');
    } catch {
      if (mounted.current && id === requestId.current) {
        setAnswerError(true);
        setMessage('We could not confirm your answer. Check your connection and retry the same answer.');
      }
    } finally {
      if (id === requestId.current) {
        answerBusy.current = false;
        if (mounted.current) setAnswerPending(false);
      }
    }
  }

  const replayComplete = loadState === 'complete' && answer === null;

  return <section className="panel practice daily" aria-labelledby="daily-title" aria-busy={loadState === 'loading' || answerPending}>
    <p className="eyebrow accent">{linked ? `SAVED QUESTION${daily ? ` · ${daily.day}` : ''}` : 'TODAY · ONE STABLE QUESTION'}</p>
    <h2 id="daily-title">{linked ? 'Linked question' : 'Today’s question'}</h2>
    <AppMenu>
      <button className="secondary" onClick={() => leave(onSetup)}>Vehicle setup</button>
      <button className="secondary" onClick={() => leave(onPractice)}>Ordinary practice</button>
      <button className="secondary" onClick={() => leave(onHistory)}>History</button>
    </AppMenu>
    <fieldset className="languages" disabled={loadState === 'loading' || answerPending}>
      <legend>Question language</legend>
      {(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="daily-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}
    </fieldset>
    {daily && <>
      <h3 className="question">{localized(language, daily.question.textEnglish, daily.question.textRussian, daily.question.textThai)}</h3>
      {daily.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{daily.question.textExamEnglish}</p></details>}
      {replayComplete
        ? <ul className="daily-complete-choices" aria-label="Answer choices">{daily.question.choices.map((item) => <li key={item.id}>{item.key}. {localized(language, item.textEnglish, item.textRussian, item.textThai)}</li>)}</ul>
        : <fieldset className="answers" disabled={answerPending || !!answer}><legend className="sr-only">Answer choices</legend>{daily.question.choices.map((item) => <label className={`answer-choice ${choice === item.id ? 'selected' : ''}`} key={item.id}>
          <input type="radio" name="daily-answer" checked={choice === item.id} onChange={() => selectChoice(item.id)} />
          <span>{item.key}. {localized(language, item.textEnglish, item.textRussian, item.textThai)}{answer?.correctChoiceId === item.id && <strong> — Correct answer</strong>}{answer?.selectedChoiceId === item.id && <strong> — Your answer</strong>}</span>
        </label>)}</fieldset>}
      {answer && <div className={`result ${answer.isCorrect ? 'correct' : 'incorrect'}`} role="region" aria-label="Answer result"><h3>{answer.isCorrect ? 'Correct' : 'Incorrect'}</h3><h4>Explanation</h4><p>{localized(language, answer.explanationEnglish, answer.explanationRussian, answer.explanationThai) ?? 'Explanation unavailable.'}</p><h4>Watch out for</h4><p>{localized(language, answer.trapExplanationEnglish, answer.trapExplanationRussian, answer.trapExplanationThai) ?? 'Trap explanation unavailable.'}</p></div>}
    </>}
    <div className={`message ${loadState === 'error' || answerError ? 'error' : ''}`} role={loadState === 'error' || answerError ? 'alert' : 'status'}><p>{message}</p></div>
    {(loadState === 'error' || loadState === 'empty') && <button className="primary" onClick={() => void loadDaily()}>{linked ? 'Retry linked question' : 'Retry today’s question'}</button>}
    {daily && loadState === 'ready' && !answer && <button className="primary" disabled={answerPending || !choice} onClick={() => void submitAnswer()}>{answerPending ? 'Please wait…' : attempted ? 'Retry answer' : 'Check answer'}</button>}
    {answer && <button className="primary next" onClick={() => leave(onPractice)}>Next question</button>}
    {replayComplete && <div className="daily-complete-actions"><button className="primary" onClick={() => leave(onHistory)}>Open History</button><button className="secondary" onClick={() => leave(onPractice)}>Continue with ordinary practice</button></div>}
  </section>;
}
