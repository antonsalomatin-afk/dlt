'use client';

import { useEffect, useRef, useState } from 'react';
import { answerSchema, favoriteResponseSchema, practiceCategoriesSchema, presentationSchema, type Answer, type PracticeCategory, type Presentation, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english || null;
const localizedCategory = (language: Language, category: PracticeCategory) =>
  (language === 'Russian' ? category.nameRussian : language === 'Thai' ? category.nameThai : category.nameEnglish)
  || category.nameEnglish || category.nameThai || category.nameRussian;

export function Practice({ session, onExpired, onVehicle, onProgress, onHistory, onMistakes, onFavorites, onExam }: { session: Session; onExpired: () => void; onVehicle: (missing?: boolean) => void; onProgress: () => void; onHistory: () => void; onMistakes: () => void; onFavorites: () => void; onExam: () => void }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [language, setLanguage] = useState<Language>('English');
  const [categories, setCategories] = useState<PracticeCategory[] | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoriesPending, setCategoriesPending] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('Loading practice categories…');
  const [error, setError] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [closed, setClosed] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [favoriteError, setFavoriteError] = useState(false);
  const [savedPresentationId, setSavedPresentationId] = useState<string | null>(null);
  const busy = useRef(false);
  const favoriteBusy = useRef(false);
  const categoriesBusy = useRef(false);
  const active = useRef(true);

  async function loadCategories() {
    if (categoriesBusy.current || !active.current) return;
    categoriesBusy.current = true; setCategoriesPending(true); setError(false); setMessage('Loading practice categories…');
    try {
      const response = await fetch('/practice/categories', {
        method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 409) { active.current = false; onVehicle(true); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const result = practiceCategoriesSchema.parse(payload);
      setCategories(result.categories); setSelectedCategoryId(null);
      setMessage(result.categories.length === 0 ? 'All categories is ready. Get a question when you are ready.' : 'Choose a practice scope, then get a question.');
    } catch {
      if (active.current) { setCategories(null); setError(true); setMessage('We could not load practice categories. Check your connection and retry.'); }
    } finally {
      if (active.current) { categoriesBusy.current = false; setCategoriesPending(false); }
    }
  }

  useEffect(() => {
    active.current = true;
    void loadCategories();
    return () => { active.current = false; };
  }, []);

  async function request(submit: boolean) {
    if (busy.current || favoriteBusy.current || !active.current || (!submit && !categories) || (submit && (!presentation || !choice || answer || closed))) return;
    busy.current = true; setPending(true); setError(false);
    const current = presentation;
    const selected = choice;
    const categoryId = selectedCategoryId;
    if (!submit) { setPresentation(null); setChoice(null); setAnswer(null); setAttempted(false); setClosed(false); setFavoriteError(false); setSavedPresentationId(null); }
    else setAttempted(true);
    setMessage(submit ? 'Checking your answer…' : 'Finding your next question…');
    try {
      const response = await fetch(submit ? '/practice/answer' : '/practice/next', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(submit ? { presentationId: current?.presentationId, choiceId: selected } : categoryId ? { categoryId } : {}),
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!submit && response.status === 409) { active.current = false; onVehicle(true); return; }
      if (!submit && response.status === 404) {
        if (categoryId) {
          const category = categories?.find((item) => item.id === categoryId);
          setMessage(`No questions are available in ${category ? localizedCategory(language, category) : 'this category'} right now. Choose another category or try again.`);
        } else setMessage('No questions available for this vehicle yet. Try again later or change your vehicle.');
        return;
      }
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

  async function saveFavorite() {
    if (busy.current || favoriteBusy.current || !active.current || !presentation) return;
    const presentationId = presentation.presentationId;
    favoriteBusy.current = true;
    setFavoritePending(true);
    setFavoriteError(false);
    try {
      const response = await fetch('/practice/favorite', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ presentationId, favorite: true }), cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (response.status === 404) {
        setFavoriteError(true); setError(true);
        setMessage('This question is no longer available to save. Continue with a new question or try again.');
        return;
      }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const result = favoriteResponseSchema.parse(payload);
      if (result.presentationId !== presentationId || result.favorite !== true) throw new Error();
      setSavedPresentationId(presentationId);
      setError(false);
      setMessage('Saved to favorites.');
    } catch {
      if (active.current) {
        setFavoriteError(true); setError(true);
        setMessage('We could not save this favorite. Check your connection and retry.');
      }
    } finally {
      favoriteBusy.current = false;
      if (active.current) setFavoritePending(false);
    }
  }

  const scopeLocked = categoriesPending || pending || (!!presentation && !answer);

  return <section className="panel practice" aria-labelledby="practice-title" aria-busy={categoriesPending || pending || favoritePending}>
    <p className="eyebrow accent">02 / ONE QUESTION AT A TIME</p>
    <h2 id="practice-title">Your next step</h2>
    <div className="panel-nav"><button className="secondary" onClick={() => { active.current = false; onVehicle(); }}>Change vehicle</button><button className="secondary" onClick={() => { active.current = false; onProgress(); }}>Progress</button><button className="secondary" onClick={() => { active.current = false; onHistory(); }}>History</button><button className="secondary" onClick={() => { active.current = false; onMistakes(); }}>Mistakes</button><button className="secondary" onClick={() => { active.current = false; onFavorites(); }}>Favorites</button><button className="secondary" onClick={() => { active.current = false; onExam(); }}>Mock exam</button></div>
    <fieldset className="languages"><legend>Practice language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    {categories && <fieldset className="practice-scope" disabled={scopeLocked}><legend>Practice scope</legend>
      <label className={selectedCategoryId === null ? 'selected' : ''}><input type="radio" name="practice-scope" value="all" checked={selectedCategoryId === null} onChange={() => setSelectedCategoryId(null)} /><span>All categories</span></label>
      {categories.map((category) => <label className={selectedCategoryId === category.id ? 'selected' : ''} key={category.id}><input type="radio" name="practice-scope" value={category.id} checked={selectedCategoryId === category.id} onChange={() => setSelectedCategoryId(category.id)} /><span>{localizedCategory(language, category)} <small>{category.questionCount} {category.questionCount === 1 ? 'question' : 'questions'}</small></span></label>)}
    </fieldset>}
    {presentation && <>
      <h3 className="question">{localized(language, presentation.question.textEnglish, presentation.question.textRussian, presentation.question.textThai)}</h3>
      {presentation.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{presentation.question.textExamEnglish}</p></details>}
      <button className="secondary favorite-action" disabled={pending || favoritePending || savedPresentationId === presentation.presentationId} onClick={() => void saveFavorite()}>{favoritePending ? 'Saving favorite…' : savedPresentationId === presentation.presentationId ? 'Saved to favorites' : favoriteError ? 'Retry favorite' : 'Save to favorites'}</button>
      <fieldset className="answers" disabled={pending || attempted || !!answer || closed}><legend className="sr-only">Answer choices</legend>{presentation.question.choices.map((item) => <label className={`answer-choice ${choice === item.id ? 'selected' : ''}`} key={item.id}>
        <input type="radio" name="answer" checked={choice === item.id} onChange={() => setChoice(item.id)} />
        <span>{item.key}. {localized(language, item.textEnglish, item.textRussian, item.textThai)}{answer?.correctChoiceId === item.id && <strong> — Correct answer</strong>}{answer?.selectedChoiceId === item.id && <strong> — Your answer</strong>}</span>
      </label>)}</fieldset>
      {answer && <div className="result" role="region" aria-label="Answer result"><h3>{answer.isCorrect ? 'Correct' : 'Incorrect'}</h3><h4>Explanation</h4><p>{localized(language, answer.explanationEnglish, answer.explanationRussian, answer.explanationThai) ?? 'Explanation unavailable.'}</p><h4>Watch out for</h4><p>{localized(language, answer.trapExplanationEnglish, answer.trapExplanationRussian, answer.trapExplanationThai) ?? 'Trap explanation unavailable.'}</p></div>}
    </>}
    <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p></div>
    {!categories && !categoriesPending && <button className="primary" onClick={() => void loadCategories()}>Retry categories</button>}
    {presentation && !answer && !closed && <button className="primary" disabled={pending || favoritePending || !choice} onClick={() => void request(true)}>{pending || favoritePending ? 'Please wait…' : attempted ? 'Retry answer' : 'Submit answer'}</button>}
    {categories && (!presentation || answer || attempted || closed) && <button className="primary next" disabled={pending || favoritePending} onClick={() => void request(false)}>{pending || favoritePending ? 'Please wait…' : presentation ? 'Continue' : 'Get a question'}</button>}
  </section>;
}

