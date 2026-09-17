'use client';

import { useEffect, useRef, useState } from 'react';
import { progressResponseSchema, type ProgressSummary, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';

const copy = {
  English: {
    eyebrow: '03 / YOUR PROGRESS', title: 'Progress', description: 'Your lifetime practice results.',
    language: 'Progress language', loading: 'Loading your progress…',
    error: 'We could not load your progress. Check your connection and retry.',
    empty: 'No answers yet. Start practicing to see your progress here.',
    back: 'Back', retry: 'Retry progress', waiting: 'Please wait…', summary: 'Lifetime progress summary',
    answered: 'Answered', correct: 'Correct', incorrect: 'Incorrect', accuracy: 'Accuracy',
  },
  Russian: {
    eyebrow: '03 / ВАШ ПРОГРЕСС', title: 'Прогресс', description: 'Ваши результаты практики за всё время.',
    language: 'Язык прогресса', loading: 'Загружаем ваш прогресс…',
    error: 'Не удалось загрузить прогресс. Проверьте соединение и повторите попытку.',
    empty: 'Ответов пока нет. Начните практиковаться, и здесь появится ваш прогресс.',
    back: 'Назад', retry: 'Повторить загрузку', waiting: 'Подождите…', summary: 'Общий прогресс за всё время',
    answered: 'Всего ответов', correct: 'Правильно', incorrect: 'Неправильно', accuracy: 'Точность',
  },
  Thai: {
    eyebrow: '03 / ความคืบหน้าของคุณ', title: 'ความคืบหน้า', description: 'ผลการฝึกทั้งหมดของคุณ',
    language: 'ภาษาสำหรับความคืบหน้า', loading: 'กำลังโหลดความคืบหน้าของคุณ…',
    error: 'เราไม่สามารถโหลดความคืบหน้าของคุณได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
    empty: 'ยังไม่มีคำตอบ เริ่มฝึกทำข้อสอบเพื่อดูความคืบหน้าของคุณที่นี่',
    back: 'ย้อนกลับ', retry: 'ลองโหลดอีกครั้ง', waiting: 'โปรดรอ…', summary: 'สรุปความคืบหน้าทั้งหมด',
    answered: 'ตอบแล้ว', correct: 'ถูกต้อง', incorrect: 'ไม่ถูกต้อง', accuracy: 'ความแม่นยำ',
  },
} as const satisfies Record<Language, Record<string, string>>;

export function Progress({ session, onBack, onExpired }: { session: Session; onBack: () => void; onExpired: () => void }) {
  const [language, setLanguage] = useState<Language>('English');
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
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
      const response = await fetch('/me/progress', {
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
      setProgress(progressResponseSchema.parse(payload));
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

  return <section className="panel progress" aria-labelledby="progress-title" aria-busy={pending}>
    <p className="eyebrow accent">{labels.eyebrow}</p>
    <h2 id="progress-title">{labels.title}</h2>
    <p className="panel-copy">{labels.description}</p>
    <button className="secondary" onClick={leave}>{labels.back}</button>
    <fieldset className="languages"><legend>{labels.language}</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="progress-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    {pending && <div className="message" role="status"><span aria-hidden="true">◌</span><p>{labels.loading}</p></div>}
    {progress && <>
      <dl className="progress-summary" aria-label={labels.summary}>
        <div className="progress-metric"><dt>{labels.answered}</dt><dd>{progress.answered}</dd></div>
        <div className="progress-metric"><dt>{labels.correct}</dt><dd>{progress.correct}</dd></div>
        <div className="progress-metric"><dt>{labels.incorrect}</dt><dd>{progress.incorrect}</dd></div>
        <div className="progress-metric"><dt>{labels.accuracy}</dt><dd>{progress.accuracyPercent === null ? '—' : `${progress.accuracyPercent}%`}</dd></div>
      </dl>
      {progress.answered === 0 && <p className="empty-progress">{labels.empty}</p>}
    </>}
    {error && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>{labels.error}</p></div>}
    {error && <button className="primary" disabled={pending} onClick={() => void request()}>{pending ? labels.waiting : labels.retry}</button>}
  </section>;
}
