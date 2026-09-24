'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  currentExamResponseSchema,
  examAnswerResponseSchema,
  examCompletionResponseSchema,
  examStartResponseSchema,
  type CurrentExam,
  type ExamCompletion,
  type Session,
} from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
type ErrorAction = 'load' | 'start' | 'answer' | 'complete';

const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || russian || thai || 'Translation unavailable.';

async function responseError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (
      payload !== null
      && typeof payload === 'object'
      && Object.keys(payload).length === 1
      && 'error' in payload
      && typeof payload.error === 'string'
    ) return payload.error;
  } catch { /* The safe fallback below covers non-JSON error bodies. */ }
  return '';
}

function remainingSeconds(expiresAt: string, clockOffsetMs: number) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - (Date.now() + clockOffsetMs)) / 1_000));
}

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function Exam({ session, onExpired, onVehicle, onPractice, onSetup }: {
  session: Session;
  onExpired: () => void;
  onVehicle: () => void;
  onPractice: () => void;
  onSetup: () => void;
}) {
  const [exam, setExam] = useState<CurrentExam | null>(null);
  const [result, setResult] = useState<ExamCompletion | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [errorAction, setErrorAction] = useState<ErrorAction>('load');
  const [message, setMessage] = useState('Checking for an exam in progress…');
  const [language, setLanguage] = useState<Language>('English');
  const [index, setIndex] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const active = useRef(true);
  const requestBusy = useRef(false);
  const completionBusy = useRef(false);
  const completionRequested = useRef(false);
  const clockOffset = useRef(0);
  const examRef = useRef<CurrentExam | null>(null);

  const installExam = useCallback((next: CurrentExam) => {
    completionRequested.current = false;
    examRef.current = next;
    setExam(next);
    setResult(null);
    setMissing(false);
    setError(false);
    const firstUnanswered = next.questions.findIndex(({ selectedChoiceId: answer }) => answer === null);
    const nextIndex = firstUnanswered < 0 ? 0 : firstUnanswered;
    setIndex(nextIndex);
    setSelectedChoiceId(next.questions[nextIndex]?.selectedChoiceId ?? null);
    setSeconds(remainingSeconds(next.expiresAt, clockOffset.current));
    setMessage(next.expired ? 'Time is up. Completing your exam…' : 'Your exam is ready. Answers are final once submitted.');
  }, []);

  const loadCurrent = useCallback(async (fromConflict = false) => {
    if (requestBusy.current || !active.current) return;
    requestBusy.current = true;
    setLoading(true); setPending(false); setError(false); setMessage('Checking for an exam in progress…');
    try {
      const receivedAt = Date.now();
      const response = await fetch('/exam/current', {
        method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 404) {
        setExam(null); examRef.current = null; setMissing(true);
        setMessage(fromConflict ? 'We could not restore the exam reported by the server. Retry before starting another.' : 'No exam is in progress. Start when you have 60 minutes available.');
        setError(fromConflict); setErrorAction('load');
        return;
      }
      if (response.status === 409 && await responseError(response) === 'Vehicle selection required') { active.current = false; onVehicle(); return; }
      if (!response.ok) throw new Error('Current exam request failed');
      const payload: unknown = await response.json();
      if (!active.current) return;
      const current = currentExamResponseSchema.parse(payload);
      if (current.vehicleType !== session.user.selectedVehicleType) throw new Error('Exam vehicle mismatch');
      clockOffset.current = Date.parse(current.serverTime) - receivedAt;
      installExam(current);
    } catch {
      if (active.current) {
        setExam(null); examRef.current = null; setMissing(false); setError(true); setErrorAction('load');
        setMessage('We could not load your mock exam. Check your connection and retry.');
      }
    } finally {
      requestBusy.current = false;
      if (active.current) setLoading(false);
    }
  }, [installExam, onExpired, onVehicle, session.token, session.user.selectedVehicleType]);

  useEffect(() => {
    active.current = true;
    void loadCurrent();
    return () => { active.current = false; };
  }, [loadCurrent]);

  const complete = useCallback(async (target: CurrentExam) => {
    if (completionBusy.current || !active.current) return;
    completionRequested.current = true;
    completionBusy.current = true;
    setPending(true); setError(false); setMessage('Completing your exam…');
    try {
      const response = await fetch('/exam/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ examId: target.examId }), cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 409) {
        const conflict = await responseError(response);
        if (conflict === 'Exam incomplete') {
          completionRequested.current = false;
          await loadCurrent(true);
          return;
        }
        throw new Error('Unknown completion conflict');
      }
      if (!response.ok) throw new Error('Completion failed');
      const payload: unknown = await response.json();
      if (!active.current) return;
      const completed = examCompletionResponseSchema.parse(payload);
      if (completed.examId !== target.examId || Date.parse(completed.completedAt) < Date.parse(target.startedAt)) throw new Error('Completion mismatch');
      setResult(completed); setError(false);
      setMessage(completed.passed ? 'You passed the mock exam.' : 'Your mock exam is complete. Keep practicing and try again.');
    } catch {
      if (active.current) { setError(true); setErrorAction('complete'); setMessage('We could not confirm your exam result. Your answers are safe; retry completion.'); }
    } finally {
      completionBusy.current = false;
      if (active.current) setPending(false);
    }
  }, [loadCurrent, onExpired, session.token]);

  useEffect(() => {
    if (!exam || result) return;
    const tick = () => {
      const next = remainingSeconds(exam.expiresAt, clockOffset.current);
      setSeconds(next);
      if (next === 0 && !requestBusy.current && !completionRequested.current) {
        completionRequested.current = true;
        void complete(examRef.current ?? exam);
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [complete, exam, result]);

  async function start() {
    if (requestBusy.current || !active.current) return;
    requestBusy.current = true; setPending(true); setError(false); setMessage('Starting your mock exam…');
    try {
      const receivedAt = Date.now();
      const response = await fetch('/exam/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({}), cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 409) {
        const conflict = await responseError(response);
        if (conflict === 'Vehicle selection required') { active.current = false; onVehicle(); return; }
        if (conflict === 'Exam already in progress') { requestBusy.current = false; await loadCurrent(true); return; }
        if (conflict === 'Not enough questions available') {
          setError(true); setErrorAction('start'); setMessage('There are not enough verified questions for this vehicle yet. Nothing was started.');
          return;
        }
        throw new Error('Unknown start conflict');
      }
      if (!response.ok) throw new Error('Start failed');
      const payload: unknown = await response.json();
      if (!active.current) return;
      const started = examStartResponseSchema.parse(payload);
      if (started.vehicleType !== session.user.selectedVehicleType) throw new Error('Exam vehicle mismatch');
      clockOffset.current = Date.parse(started.startedAt) - receivedAt;
      installExam({ ...started, serverTime: started.startedAt, expired: false, answeredCount: 0, remainingCount: 50, questions: started.questions.map((question) => ({ ...question, selectedChoiceId: null, answeredAt: null })) });
    } catch {
      if (active.current) { setError(true); setErrorAction('start'); setMessage('We could not start your mock exam. Check your connection and try again.'); }
    } finally {
      requestBusy.current = false;
      if (active.current) setPending(false);
    }
  }

  async function answer() {
    const target = examRef.current;
    const question = target?.questions[index];
    if (requestBusy.current || completionBusy.current || !active.current || !target || !question || question.selectedChoiceId || !selectedChoiceId || seconds === 0) return;
    requestBusy.current = true; setPending(true); setError(false); setMessage('Saving your answer…');
    try {
      const response = await fetch('/exam/answer', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ examQuestionId: question.examQuestionId, choiceId: selectedChoiceId }), cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 409) {
        const conflict = await responseError(response);
        if (conflict === 'Exam expired' || conflict === 'Exam already completed') { requestBusy.current = false; await complete(target); return; }
        if (conflict === 'Answer already submitted') { requestBusy.current = false; await loadCurrent(true); return; }
        setError(true); setErrorAction('answer'); setMessage('The server could not accept this answer. Reload the current exam before trying again.');
        return;
      }
      if (!response.ok) throw new Error('Answer failed');
      const payload: unknown = await response.json();
      if (!active.current) return;
      const saved = examAnswerResponseSchema.parse(payload);
      if (
        saved.examId !== target.examId
        || saved.examQuestionId !== question.examQuestionId
        || saved.selectedChoiceId !== selectedChoiceId
        || !question.question.choices.some(({ id }) => id === saved.selectedChoiceId)
        || Date.parse(saved.answeredAt) < Date.parse(target.startedAt)
        || Date.parse(saved.answeredAt) >= Date.parse(target.expiresAt)
        || saved.answeredCount !== target.answeredCount + 1
        || saved.remainingCount !== target.remainingCount - 1
      ) throw new Error('Answer acknowledgement mismatch');
      const questions = target.questions.map((item, questionIndex) => questionIndex === index
        ? { ...item, selectedChoiceId: saved.selectedChoiceId, answeredAt: saved.answeredAt }
        : item);
      const next = { ...target, answeredCount: saved.answeredCount, remainingCount: saved.remainingCount, questions };
      examRef.current = next; setExam(next); setSelectedChoiceId(saved.selectedChoiceId);
      setMessage('Answer saved. Correctness stays hidden until the exam is complete.');
      if (saved.remainingCount === 0) {
        requestBusy.current = false;
        completionRequested.current = true;
        await complete(next);
      } else {
        const nextIndex = questions.findIndex((item, questionIndex) => questionIndex > index && item.selectedChoiceId === null);
        const fallback = questions.findIndex((item) => item.selectedChoiceId === null);
        const destination = nextIndex >= 0 ? nextIndex : fallback;
        setIndex(destination); setSelectedChoiceId(null);
      }
    } catch {
      if (active.current) { setError(true); setErrorAction('answer'); setMessage('We could not confirm your answer. Keep the same choice and retry, or reload the exam.'); }
    } finally {
      requestBusy.current = false;
      if (active.current) setPending(false);
    }
  }

  function move(nextIndex: number) {
    const target = examRef.current?.questions[nextIndex];
    if (!target) return;
    setIndex(nextIndex); setSelectedChoiceId(target.selectedChoiceId);
  }

  if (loading) return <section className="panel exam" aria-labelledby="exam-title" aria-busy="true"><p className="eyebrow accent">03 / MOCK EXAM</p><h2 id="exam-title">Mock exam</h2><div className="message" role="status"><p>{message}</p></div></section>;

  if (!exam) return <section className="panel exam" aria-labelledby="exam-title" aria-busy={pending}>
    <p className="eyebrow accent">03 / MOCK EXAM</p><h2 id="exam-title">Mock exam</h2>
    {missing && <div className="exam-intro"><dl><div><dt>Questions</dt><dd>50</dd></div><div><dt>Time</dt><dd>60 minutes</dd></div><div><dt>Pass</dt><dd>45 / 50</dd></div></dl><p>Answers are final. Results and correctness appear only after completion.</p></div>}
    <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p></div>
    {error && errorAction === 'load' ? <button className="primary" onClick={() => void loadCurrent()}>Retry exam</button> : missing ? <button className="primary" disabled={pending} onClick={() => void start()}>{pending ? 'Starting…' : errorAction === 'start' && error ? 'Try starting again' : 'Start mock exam'}</button> : null}
    <button className="secondary" onClick={() => { active.current = false; onSetup(); }}>Back to setup</button>
  </section>;

  if (result) return <section className="panel exam" aria-labelledby="exam-title">
    <p className="eyebrow accent">03 / MOCK EXAM</p><h2 id="exam-title">Mock exam result</h2>
    <div className={`exam-result ${result.passed ? 'passed' : 'failed'}`} role="region" aria-label="Mock exam result"><h3>{result.passed ? 'Passed' : 'Not passed yet'}</h3><p className="exam-score">{result.score} / {result.questionCount}</p><dl><div><dt>Passing score</dt><dd>{result.passingScore}</dd></div><div><dt>Answered</dt><dd>{result.answeredCount}</dd></div><div><dt>Unanswered</dt><dd>{result.unansweredCount}</dd></div></dl><time dateTime={result.completedAt}>Completed {new Date(result.completedAt).toLocaleString()}</time></div>
    <div className="message" role="status"><p>{message}</p></div>
    <button className="primary" onClick={() => { active.current = false; onPractice(); }}>Return to practice</button><button className="secondary" onClick={() => { active.current = false; onSetup(); }}>Back to setup</button>
  </section>;

  const question = exam.questions[index]!;
  const answered = question.selectedChoiceId !== null;
  return <section className="panel exam" aria-labelledby="exam-title" aria-busy={pending}>
    <div className="exam-heading"><div><p className="eyebrow accent">03 / MOCK EXAM</p><h2 id="exam-title">Question {question.position} of 50</h2></div><div className="exam-timer" role="timer" aria-label="Time remaining">{clock(seconds)}</div></div>
    <div className="exam-progress" aria-label="Exam progress"><span>{exam.answeredCount} answered</span><span>{exam.remainingCount} remaining</span></div>
    <fieldset className="languages"><legend>Exam language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="exam-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    <nav className="exam-navigator" aria-label="Question navigator">{exam.questions.map((item, questionIndex) => <button key={item.examQuestionId} className={`${questionIndex === index ? 'current' : ''} ${item.selectedChoiceId ? 'answered' : ''}`} aria-current={questionIndex === index ? 'step' : undefined} aria-label={`Question ${item.position}, ${item.selectedChoiceId ? 'answered' : 'unanswered'}`} onClick={() => move(questionIndex)}>{item.position}</button>)}</nav>
    <h3 className="question">{localized(language, question.question.textEnglish, question.question.textRussian, question.question.textThai)}</h3>
    {question.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{question.question.textExamEnglish}</p></details>}
    <fieldset className="answers" disabled={pending || answered || seconds === 0}><legend className="sr-only">Answer choices</legend>{question.question.choices.map((choice) => <label className={`answer-choice ${selectedChoiceId === choice.id ? 'selected' : ''}`} key={choice.id}><input type="radio" name={`exam-answer-${question.examQuestionId}`} checked={selectedChoiceId === choice.id} onChange={() => setSelectedChoiceId(choice.id)} /><span>{choice.key}. {localized(language, choice.textEnglish, choice.textRussian, choice.textThai)}</span></label>)}</fieldset>
    {answered && <p className="exam-saved" role="status">Answer saved. This question is read-only.</p>}
    <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p></div>
    {error && errorAction === 'complete' ? <button className="primary" disabled={pending} onClick={() => void complete(exam)}>{pending ? 'Completing…' : 'Retry completion'}</button> : error && errorAction === 'answer' ? <div className="exam-actions"><button className="primary" disabled={pending || !selectedChoiceId} onClick={() => void answer()}>Retry answer</button><button className="secondary" disabled={pending} onClick={() => void loadCurrent(true)}>Reload exam</button></div> : !answered && seconds > 0 ? <button className="primary" disabled={pending || !selectedChoiceId} onClick={() => void answer()}>{pending ? 'Saving…' : 'Submit answer'}</button> : null}
    <div className="exam-controls"><button className="secondary" disabled={index === 0 || pending} onClick={() => move(index - 1)}>Previous</button><button className="secondary" disabled={index === 49 || pending} onClick={() => move(index + 1)}>Next</button></div>
    <button className="secondary" onClick={() => { active.current = false; onPractice(); }}>Leave exam</button>
  </section>;
}
