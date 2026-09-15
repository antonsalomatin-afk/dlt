'use client';

import { useEffect, useRef, useState } from 'react';
import { answerSchema, presentationSchema, type Answer, type Presentation, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || null;

export function Practice({ session, onExpired, onVehicle, onHistory, onMistakes }: { session: Session; onExpired: () => void; onVehicle: (missing?: boolean) => void; onHistory: () => void; onMistakes: () => void }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [language, setLanguage] = useState<Language>('English');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('Ready for a little practice?');
  const [error, setError] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [closed, setClosed] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function request(submit: boolean) {
    if (busy.current || !active.current || (submit && (!presentation || !choice || answer || closed))) return;
    busy.current = true; setPending(true); setError(false);
    const current = presentation;
    const selected = choice;
    if (!submit) { setPresentation(null); setChoice(null); setAnswer(null); setAttempted(false); setClosed(false); }
    else setAttempted(true);
    setMessage(submit ? 'Checking your answer…' : 'Finding your next question…');
    try {
      const response = await fetch(submit ? '/practice/answer' : '/practice/next', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(submit ? { presentationId: current?.presentationId, choiceId: selected } : {}),
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!submit && response.status === 409) { active.current = false; onVehicle(true); return; }
      if (!submit && response.status === 404) { setMessage('No questions available for this vehicle yet. Try again later or change your vehicle.'); return; }
      if (submit && response.status === 409) { setClosed(true); setError(true); setMessage('This answer was already submitted. We cannot confirm the result here. Continue with a new question.'); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      if (submit) {
        const result = answerSchema.parse(payload);
        if (result.presentationId !== current?.presentationId || result.selectedChoiceId !== selected ||
          !current.question.choices.some((item) => item.id === result.correctChoiceId) ||
          result.isCorrect !== (result.selectedChoiceId === result.correctChoiceId)) throw new Error();
        setAnswer(result); setMessage('Answer saved. Take a moment to understand the rule.');
      } else { setPresentation(presentationSchema.parse(payload)); setMessage('Choose one answer, then submit.'); }
    } catch {
      if (active.current) { setError(true); setMessage(submit ? 'We could not confirm your answer. Check your connection and retry the same answer, or continue with a new question.' : 'We could not load a question. Check your connection and try again.'); }
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }

  return <section className="panel practice" aria-labelledby="practice-title" aria-busy={pending}>
    <p className="eyebrow accent">02 / ONE QUESTION AT A TIME</p>
    <h2 id="practice-title">Your next step</h2>
    <div className="panel-nav"><button className="secondary" onClick={() => { active.current = false; onVehicle(); }}>Change vehicle</button><button className="secondary" onClick={() => { active.current = false; onHistory(); }}>History</button><button className="secondary" onClick={() => { active.current = false; onMistakes(); }}>Mistakes</button></div>
    {presentation && <>
      <fieldset className="languages"><legend>Question language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
      <h3 className="question">{localized(language, presentation.question.textEnglish, presentation.question.textRussian, presentation.question.textThai)}</h3>
      {presentation.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{presentation.question.textExamEnglish}</p></details>}
      <fieldset className="answers" disabled={pending || attempted || !!answer || closed}><legend className="sr-only">Answer choices</legend>{presentation.question.choices.map((item) => <label className={`answer-choice ${choice === item.id ? 'selected' : ''}`} key={item.id}>
        <input type="radio" name="answer" checked={choice === item.id} onChange={() => setChoice(item.id)} />
        <span>{item.key}. {localized(language, item.textEnglish, item.textRussian, item.textThai)}{answer?.correctChoiceId === item.id && <strong> — Correct answer</strong>}{answer?.selectedChoiceId === item.id && <strong> — Your answer</strong>}</span>
      </label>)}</fieldset>
      {answer && <div className="result" role="region" aria-label="Answer result"><h3>{answer.isCorrect ? 'Correct' : 'Incorrect'}</h3><h4>Explanation</h4><p>{localized(language, answer.explanationEnglish, answer.explanationRussian, answer.explanationThai) ?? 'Explanation unavailable.'}</p><h4>Watch out for</h4><p>{localized(language, answer.trapExplanationEnglish, answer.trapExplanationRussian, answer.trapExplanationThai) ?? 'Trap explanation unavailable.'}</p></div>}
    </>}
    <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p></div>
    {presentation && !answer && !closed && <button className="primary" disabled={pending || !choice} onClick={() => void request(true)}>{pending ? 'Please wait…' : attempted ? 'Retry answer' : 'Submit answer'}</button>}
    {(!presentation || answer || attempted || closed) && <button className="primary next" disabled={pending} onClick={() => void request(false)}>{pending ? 'Please wait…' : presentation ? 'Continue' : 'Get a question'}</button>}
  </section>;
}

