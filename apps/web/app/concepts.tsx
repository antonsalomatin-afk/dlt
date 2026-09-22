'use client';

import { useEffect, useRef, useState } from 'react';
import { conceptProgressResponseSchema, type ConceptProgress, type ConceptProgressItem, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';

const copy = {
  English: {
    eyebrow: '06 / YOUR WEAKEST RULES', title: 'Concepts', description: 'Your practice accuracy for each rule, weakest first.',
    language: 'Concepts language', loading: 'Loading your concepts…',
    error: 'We could not load your concepts. Check your connection and retry.',
    empty: 'No answers yet. Practise a few questions and your weakest rules will appear here.',
    back: 'Back', retry: 'Retry concepts', waiting: 'Please wait…',
    total: 'Lifetime practice total', list: 'Practice accuracy by concept',
    answered: 'Answered', correct: 'Correct', incorrect: 'Incorrect', accuracy: 'Accuracy',
    unassigned: 'Not grouped yet', unassignedNote: 'Questions that do not belong to a concept yet.',
    of: (correct: number, answered: number) => `${correct} of ${answered} correct`,
  },
  Russian: {
    eyebrow: '06 / ВАШИ СЛАБЫЕ ПРАВИЛА', title: 'Правила', description: 'Точность практики по каждому правилу, начиная со слабых.',
    language: 'Язык правил', loading: 'Загружаем ваши правила…',
    error: 'Не удалось загрузить правила. Проверьте соединение и повторите попытку.',
    empty: 'Ответов пока нет. Ответьте на несколько вопросов, и здесь появятся ваши слабые правила.',
    back: 'Назад', retry: 'Повторить загрузку', waiting: 'Подождите…',
    total: 'Итог практики за всё время', list: 'Точность практики по правилам',
    answered: 'Всего ответов', correct: 'Правильно', incorrect: 'Неправильно', accuracy: 'Точность',
    unassigned: 'Без правила', unassignedNote: 'Вопросы, ещё не отнесённые к правилу.',
    of: (correct: number, answered: number) => `${correct} из ${answered} правильно`,
  },
  Thai: {
    eyebrow: '06 / กฎที่คุณยังไม่แม่น', title: 'กฎ', description: 'ความแม่นยำในการฝึกของแต่ละกฎ เริ่มจากกฎที่ยังไม่แม่น',
    language: 'ภาษาสำหรับกฎ', loading: 'กำลังโหลดกฎของคุณ…',
    error: 'เราไม่สามารถโหลดกฎของคุณได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
    empty: 'ยังไม่มีคำตอบ ลองฝึกทำข้อสอบสักสองสามข้อ แล้วกฎที่คุณยังไม่แม่นจะปรากฏที่นี่',
    back: 'ย้อนกลับ', retry: 'ลองโหลดอีกครั้ง', waiting: 'โปรดรอ…',
    total: 'สรุปการฝึกทั้งหมด', list: 'ความแม่นยำในการฝึกแยกตามกฎ',
    answered: 'ตอบแล้ว', correct: 'ถูกต้อง', incorrect: 'ไม่ถูกต้อง', accuracy: 'ความแม่นยำ',
    unassigned: 'ยังไม่จัดกลุ่ม', unassignedNote: 'คำถามที่ยังไม่ได้จัดอยู่ในกฎใด',
    of: (correct: number, answered: number) => `ถูก ${correct} จาก ${answered} ข้อ`,
  },
} as const satisfies Record<Language, Record<string, unknown>>;

const conceptName = (language: Language, item: ConceptProgressItem) =>
  (language === 'Russian' ? item.nameRussian : language === 'Thai' ? item.nameThai : item.nameEnglish) || item.nameEnglish;

export function Concepts({ session, onBack, onExpired }: { session: Session; onBack: () => void; onExpired: () => void }) {
  const [language, setLanguage] = useState<Language>('English');
  const [progress, setProgress] = useState<ConceptProgress | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const labels = copy[language];

  async function request() {
    if (busy.current || !active.current) return;
    busy.current = true;
    setPending(true);
    setError(false);
    setProgress(null);
    try {
      const response = await fetch('/me/progress/concepts', {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      setProgress(conceptProgressResponseSchema.parse(payload));
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) { busy.current = false; setPending(false); }
    }
  }

  useEffect(() => {
    active.current = true;
    void request();
    return () => { active.current = false; };
  }, []);

  const leave = () => { active.current = false; onBack(); };

  return <section className="panel concepts" aria-labelledby="concepts-title" aria-busy={pending}>
    <p className="eyebrow accent">{labels.eyebrow}</p>
    <h2 id="concepts-title">{labels.title}</h2>
    <p className="panel-copy">{labels.description}</p>
    <button className="secondary" onClick={leave}>{labels.back}</button>
    <fieldset className="languages"><legend>{labels.language}</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="concepts-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    {pending && <div className="message" role="status"><span aria-hidden="true">◌</span><p>{labels.loading}</p></div>}
    {progress && <>
      <dl className="progress-summary" aria-label={labels.total}>
        <div className="progress-metric"><dt>{labels.answered}</dt><dd>{progress.total.answered}</dd></div>
        <div className="progress-metric"><dt>{labels.correct}</dt><dd>{progress.total.correct}</dd></div>
        <div className="progress-metric"><dt>{labels.incorrect}</dt><dd>{progress.total.incorrect}</dd></div>
        <div className="progress-metric"><dt>{labels.accuracy}</dt><dd>{progress.total.accuracyPercent === null ? '—' : `${progress.total.accuracyPercent}%`}</dd></div>
      </dl>
      {progress.total.answered === 0 && <p className="empty-progress">{labels.empty}</p>}
      {progress.concepts.length > 0 && <ul className="concept-list" aria-label={labels.list}>{progress.concepts.map((item) => <li className="concept-row" key={item.conceptId}>
        <div className="concept-head">
          <span className="concept-name">{conceptName(language, item)}</span>
          <span className="concept-accuracy">{item.accuracyPercent}%</span>
        </div>
        <span className="concept-bar" aria-hidden="true"><i style={{ width: `${item.accuracyPercent}%` }} /></span>
        <p className="concept-counts">{labels.of(item.correct, item.answered)}</p>
      </li>)}</ul>}
      {progress.unassigned.answered > 0 && <div className="concept-unassigned">
        <p><strong>{labels.unassigned}</strong> · {labels.of(progress.unassigned.correct, progress.unassigned.answered)}{progress.unassigned.accuracyPercent === null ? '' : ` · ${progress.unassigned.accuracyPercent}%`}</p>
        <p className="concept-note">{labels.unassignedNote}</p>
      </div>}
    </>}
    {error && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>{labels.error}</p></div>}
    {error && <button className="primary" disabled={pending} onClick={() => void request()}>{pending ? labels.waiting : labels.retry}</button>}
  </section>;
}
