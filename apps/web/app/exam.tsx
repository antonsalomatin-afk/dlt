'use client';

import { useEffect, useRef, useState } from 'react';
import { EXAM_QUESTION_COUNT, examAnswerSchema, examCompleteSchema, examStartSchema, type ExamComplete, type ExamStart, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || null;

const requestInit = (token: string, body: unknown) => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
  cache: 'no-store' as const,
  signal: AbortSignal.timeout(15000),
});

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function Exam({ session, onBack, onExpired, onVehicle, onHistory }: { session: Session; onBack: () => void; onExpired: () => void; onVehicle: () => void; onHistory: () => void }) {
  const [language, setLanguage] = useState<Language>('English');
  const [exam, setExam] = useState<ExamStart | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answeredCount, setAnsweredCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<ExamComplete | null>(null);
  const [serverExpired, setServerExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('Fifty questions. Sixty minutes. Forty-five correct answers to pass. Ready when you are.');
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const clockOffset = useRef(0);
  const busy = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!exam || result) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [exam, result]);

  const remainingMs = exam ? Date.parse(exam.expiresAt) - (now + clockOffset.current) : 0;
  const timeUp = !!exam && (serverExpired || remainingMs <= 0);
  const current = exam?.questions[index] ?? null;
  const currentAnswer = current ? answers[current.examQuestionId] ?? null : null;
  const remainingCount = EXAM_QUESTION_COUNT - answeredCount;
  const canFinish = !!exam && !result && (answeredCount === EXAM_QUESTION_COUNT || timeUp);

  function leave() { active.current = false; onBack(); }

  function moveTo(nextIndex: number) {
    if (!exam || pending) return;
    const bounded = Math.min(Math.max(nextIndex, 0), EXAM_QUESTION_COUNT - 1);
    setIndex(bounded); setChoice(null); setAttempted(false); setError(false);
    setMessage(answers[exam.questions[bounded]?.examQuestionId ?? ''] ? 'This question is already answered.' : timeUp ? 'Time is up. Finish the exam to see your result.' : 'Choose one answer, then submit.');
  }

  async function start() {
    if (busy.current || !active.current) return;
    busy.current = true; setPending(true); setError(false); setMessage('Preparing your exam…');
    try {
      const response = await fetch('/exam/start', requestInit(session.token, {}));
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 409) {
        const payload: unknown = await response.json().catch(() => null);
        if (!active.current) return;
        const code = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null;
        if (code === 'Vehicle selection required') { active.current = false; onVehicle(); return; }
        setError(true); setMessage('You already have an exam in progress. It unlocks when its 60 minutes end. Try again later.');
        return;
      }
      if (response.status === 404) { setError(true); setMessage('Not enough questions are available for this vehicle yet. Try again later.'); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const started = examStartSchema.parse(payload);
      if (started.vehicleType !== session.user.selectedVehicleType) throw new Error();
      // Anchor the countdown to the server's start time so client clock skew cannot shorten or extend it.
      clockOffset.current = Date.parse(started.startedAt) - Date.now();
      setExam(started); setAnswers({}); setAnsweredCount(0); setIndex(0); setChoice(null); setAttempted(false); setResult(null); setServerExpired(false);
      setNow(Date.now());
      setMessage('Choose one answer, then submit.');
    } catch {
      if (active.current) { setError(true); setMessage('We could not start your exam. Check your connection and try again.'); }
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }

  async function complete(examId: string) {
    const response = await fetch('/exam/complete', requestInit(session.token, { examId }));
    if (!active.current) return 'left' as const;
    if (response.status === 401) { active.current = false; onExpired(); return 'left' as const;  }
    if (response.status === 409) return 'incomplete' as const;
    if (!response.ok) throw new Error();
    const payload: unknown = await response.json();
    if (!active.current) return 'left' as const;
    const summary = examCompleteSchema.parse(payload);
    if (summary.examId !== examId) throw new Error();
    setResult(summary); setError(false);
    setMessage(summary.passed ? 'Congratulations — you passed this mock exam.' : 'Not passed this time. Review the rules and try again.');
    return 'done' as const;
  }

  async function finish() {
    if (busy.current || !active.current || !exam || !canFinish) return;
    busy.current = true; setPending(true); setError(false); setMessage('Scoring your exam…');
    try {
      const outcome = await complete(exam.examId);
      if (outcome === 'incomplete') { setError(true); setMessage(`Your exam is not finished yet: ${remainingCount} ${remainingCount === 1 ? 'question is' : 'questions are'} unanswered.`); }
    } catch {
      if (active.current) { setError(true); setMessage('We could not score your exam. Check your connection and retry.'); }
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }

  async function submit() {
    if (busy.current || !active.current || !exam || !current || !choice || currentAnswer || timeUp) return;
    busy.current = true; setPending(true); setError(false); setAttempted(true); setMessage('Saving your answer…');
    const examQuestionId = current.examQuestionId;
    const choiceId = choice;
    try {
      const response = await fetch('/exam/answer', requestInit(session.token, { examQuestionId, choiceId }));
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 404) { setError(true); setMessage('This exam question is not available. Retry the same answer or move to another question.'); return; }
      if (response.status === 409) {
        const payload: unknown = await response.json().catch(() => null);
        if (!active.current) return;
        const code = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null;
        if (code === 'Answer already submitted') {
          setAnswers((previous) => ({ ...previous, [examQuestionId]: previous[examQuestionId] ?? choiceId }));
          setAnsweredCount((previous) => Math.min(previous + 1, EXAM_QUESTION_COUNT));
          setError(true); setMessage('This question was already answered. Your saved answer stands. Continue with the next question.');
          return;
        }
        if (code === 'Exam expired') { setServerExpired(true); setError(true); setMessage('Time is up. Finish the exam to see your result.'); return; }
        if (code === 'Exam already completed') {
          setMessage('This exam is already finished. Loading your result…');
          await complete(exam.examId);
          return;
        }
        throw new Error();
      }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const saved = examAnswerSchema.parse(payload);
      if (saved.examId !== exam.examId || saved.examQuestionId !== examQuestionId || saved.selectedChoiceId !== choiceId) throw new Error();
      setAnswers((previous) => ({ ...previous, [examQuestionId]: choiceId }));
      setAnsweredCount(saved.answeredCount);
      setMessage(saved.remainingCount === 0 ? 'All questions answered. Finish the exam to see your result.' : 'Answer saved. Move to the next question.');
    } catch {
      if (active.current) { setError(true); setMessage('We could not save your answer. Check your connection and retry the same answer.'); }
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }

  function restart() {
    if (pending) return;
    setExam(null); setAnswers({}); setAnsweredCount(0); setIndex(0); setChoice(null); setAttempted(false); setResult(null); setServerExpired(false); setError(false);
    setMessage('Fifty questions. Sixty minutes. Forty-five correct answers to pass. Ready when you are.');
  }

  return <section className="panel practice exam" aria-labelledby="exam-title" aria-busy={pending}>
    <p className="eyebrow accent">04 / MOCK EXAM</p>
    <h2 id="exam-title">{result ? 'Exam complete' : exam ? 'Mock exam' : 'Ready for the real thing?'}</h2>
    <button className="secondary" onClick={leave}>Back</button>
    {!exam && <>
      <p className="panel-copy">The mock exam mirrors the official test: 50 questions, 60 minutes, and 45 correct answers to pass. You will not see correct answers until you finish.</p>
      <dl className="progress-summary" aria-label="Exam policy">
        <div className="progress-metric"><dt>Questions</dt><dd>50</dd></div>
        <div className="progress-metric"><dt>Minutes</dt><dd>60</dd></div>
        <div className="progress-metric"><dt>Pass mark</dt><dd>45</dd></div>
        <div className="progress-metric"><dt>Vehicle</dt><dd>{session.user.selectedVehicleType === 'MOTORCYCLE' ? 'Motorcycle' : 'Car'}</dd></div>
      </dl>
    </>}
    {exam && !result && <>
      <div className="exam-status" role="group" aria-label="Exam status">
        <span className="exam-timer" role="timer" aria-label="Time remaining">{formatRemaining(remainingMs)}</span>
        <span className="exam-counts">Answered {answeredCount} · Remaining {remainingCount}</span>
      </div>
      <fieldset className="languages"><legend>Exam language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="exam-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
      {current && <>
        <p className="exam-position">Question {current.position} of {EXAM_QUESTION_COUNT}</p>
        <h3 className="question">{localized(language, current.question.textEnglish, current.question.textRussian, current.question.textThai)}</h3>
        {current.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{current.question.textExamEnglish}</p></details>}
        <fieldset className="answers" disabled={pending || !!currentAnswer || timeUp}><legend className="sr-only">Answer choices</legend>{current.question.choices.map((item) => <label className={`answer-choice ${(currentAnswer ?? choice) === item.id ? 'selected' : ''}`} key={item.id}>
          <input type="radio" name="exam-answer" checked={(currentAnswer ?? choice) === item.id} onChange={() => setChoice(item.id)} />
          <span>{item.key}. {localized(language, item.textEnglish, item.textRussian, item.textThai)}{currentAnswer === item.id && <strong> — Your answer</strong>}</span>
        </label>)}</fieldset>
      </>}
    </>}
    {result && <dl className="progress-summary" aria-label="Exam result">
      <div className="progress-metric"><dt>Score</dt><dd>{result.score} / {result.questionCount}</dd></div>
      <div className="progress-metric"><dt>Pass mark</dt><dd>{result.passingScore}</dd></div>
      <div className="progress-metric"><dt>Answered</dt><dd>{result.answeredCount}</dd></div>
      <div className="progress-metric"><dt>Unanswered</dt><dd>{result.unansweredCount}</dd></div>
      <div className={`progress-metric exam-outcome ${result.passed ? 'passed' : 'failed'}`}><dt>Result</dt><dd>{result.passed ? 'Passed' : 'Not passed'}</dd></div>
    </dl>}
    <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p></div>
    {!exam && <button className="primary" disabled={pending} onClick={() => void start()}>{pending ? 'Please wait…' : error ? 'Retry exam start' : 'Start exam'}</button>}
    {exam && !result && <>
      {current && !currentAnswer && !timeUp && <button className="primary" disabled={pending || !choice} onClick={() => void submit()}>{pending ? 'Please wait…' : attempted ? 'Retry answer' : 'Submit answer'}</button>}
      <div className="panel-nav exam-nav">
        <button className="secondary" disabled={pending || index === 0} onClick={() => moveTo(index - 1)}>Previous question</button>
        <button className="secondary" disabled={pending || index === EXAM_QUESTION_COUNT - 1} onClick={() => moveTo(index + 1)}>Next question</button>
      </div>
      <button className="primary next" disabled={pending || !canFinish} onClick={() => void finish()}>{pending ? 'Please wait…' : 'Finish exam'}</button>
    </>}
    {result && <button className="primary next" disabled={pending} onClick={restart}>Start another exam</button>}
    {result && <button className="secondary" disabled={pending} onClick={() => { active.current = false; onHistory(); }}>Review in exam history</button>}
  </section>;
}
