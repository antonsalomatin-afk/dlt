'use client';

import { useEffect, useRef, useState } from 'react';
import {
  appendConceptProgressPage,
  conceptProgressResponseSchema,
  progressResponseSchema,
  type ConceptProgressItem,
  type ProgressSummary,
  type Session,
} from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';
type Failure = 'summary' | 'concept' | null;

const copy = {
  English: {
    eyebrow: '03 / YOUR PROGRESS', title: 'Progress', description: 'Your lifetime practice results.',
    language: 'Progress language', loading: 'Loading your progress…', loadingMore: 'Loading more concepts…',
    error: 'We could not load your progress. Check your connection and retry.',
    conceptError: 'We could not load your concept progress. Your validated results are still shown; retry to continue.',
    empty: 'No answers yet. Start practicing to see progress here. Your concept mastery is Not started.',
    back: 'Back', retry: 'Retry progress', waiting: 'Please wait…', summary: 'Lifetime progress summary',
    answered: 'Answered', correct: 'Correct', incorrect: 'Incorrect', accuracy: 'Accuracy',
    concepts: 'Concept progress', practice: 'Practice', exam: 'Exam', total: 'Total', mastery: 'Mastery',
    lastActivity: 'Last activity', loadMore: 'Load more',
    NOT_STARTED: 'Not started', LEARNING: 'Learning', MASTERED: 'Mastered',
  },
  Russian: {
    eyebrow: '03 / ВАШ ПРОГРЕСС', title: 'Прогресс', description: 'Ваши результаты практики за всё время.',
    language: 'Язык прогресса', loading: 'Загружаем ваш прогресс…', loadingMore: 'Загружаем другие темы…',
    error: 'Не удалось загрузить прогресс. Проверьте соединение и повторите попытку.',
    conceptError: 'Не удалось загрузить прогресс по темам. Проверенные результаты сохранены; повторите попытку.',
    empty: 'Ответов пока нет. Уровень тем: Не начато. Начните практиковаться, чтобы увидеть прогресс.',
    back: 'Назад', retry: 'Повторить загрузку', waiting: 'Подождите…', summary: 'Общий прогресс за всё время',
    answered: 'Всего ответов', correct: 'Правильно', incorrect: 'Неправильно', accuracy: 'Точность',
    concepts: 'Прогресс по темам', practice: 'Практика', exam: 'Экзамен', total: 'Всего', mastery: 'Освоение',
    lastActivity: 'Последняя активность', loadMore: 'Загрузить ещё',
    NOT_STARTED: 'Не начато', LEARNING: 'Изучается', MASTERED: 'Освоено',
  },
  Thai: {
    eyebrow: '03 / ความคืบหน้าของคุณ', title: 'ความคืบหน้า', description: 'ผลการฝึกทั้งหมดของคุณ',
    language: 'ภาษาสำหรับความคืบหน้า', loading: 'กำลังโหลดความคืบหน้าของคุณ…', loadingMore: 'กำลังโหลดแนวคิดเพิ่มเติม…',
    error: 'เราไม่สามารถโหลดความคืบหน้าของคุณได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
    conceptError: 'ไม่สามารถโหลดความคืบหน้าตามแนวคิดได้ ผลที่ตรวจสอบแล้วจะยังแสดงอยู่ โปรดลองอีกครั้ง',
    empty: 'ยังไม่มีคำตอบ ระดับแนวคิดคือ ยังไม่เริ่ม เริ่มฝึกทำข้อสอบเพื่อดูความคืบหน้า',
    back: 'ย้อนกลับ', retry: 'ลองโหลดอีกครั้ง', waiting: 'โปรดรอ…', summary: 'สรุปความคืบหน้าทั้งหมด',
    answered: 'ตอบแล้ว', correct: 'ถูกต้อง', incorrect: 'ไม่ถูกต้อง', accuracy: 'ความแม่นยำ',
    concepts: 'ความคืบหน้าตามแนวคิด', practice: 'แบบฝึกหัด', exam: 'ข้อสอบ', total: 'รวม', mastery: 'ระดับความเข้าใจ',
    lastActivity: 'กิจกรรมล่าสุด', loadMore: 'โหลดเพิ่มเติม',
    NOT_STARTED: 'ยังไม่เริ่ม', LEARNING: 'กำลังเรียนรู้', MASTERED: 'เชี่ยวชาญแล้ว',
  },
} as const satisfies Record<Language, Record<string, string>>;

function conceptName(item: ConceptProgressItem, language: Language) {
  return language === 'Thai' ? item.nameThai : language === 'Russian' ? item.nameRussian : item.nameEnglish;
}

export function Progress({ session, onBack, onExpired }: { session: Session; onBack: () => void; onExpired: () => void }) {
  const [language, setLanguage] = useState<Language>('English');
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [concepts, setConcepts] = useState<ConceptProgressItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [conceptsLoaded, setConceptsLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<Failure>(null);
  const busy = useRef(false);
  const active = useRef(true);
  const conceptsRef = useRef<ConceptProgressItem[]>([]);
  const labels = copy[language];

  async function fetchJson(path: string) {
    const response = await fetch(path, {
      method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!active.current) return null;
    if (response.status === 401) { active.current = false; onExpired(); return null; }
    if (!response.ok) throw new Error();
    const payload: unknown = await response.json();
    return active.current ? payload : null;
  }

  async function requestInitial() {
    if (busy.current || !active.current) return;
    busy.current = true;
    setPending(true);
    setFailure(null);
    setProgress(null);
    setConcepts([]);
    conceptsRef.current = [];
    setNextCursor(null);
    setConceptsLoaded(false);
    try {
      const summaryPayload = await fetchJson('/me/progress');
      if (summaryPayload === null) return;
      setProgress(progressResponseSchema.parse(summaryPayload));
      try {
        const conceptPayload = await fetchJson('/me/concept-progress?limit=10');
        if (conceptPayload === null) return;
        const page = conceptProgressResponseSchema.parse(conceptPayload);
        const appended = appendConceptProgressPage([], page);
        conceptsRef.current = appended;
        setConcepts(appended);
        setNextCursor(page.nextCursor);
        setConceptsLoaded(true);
      } catch {
        if (active.current) setFailure('concept');
      }
    } catch {
      if (active.current) setFailure('summary');
    } finally {
      if (active.current) { busy.current = false; setPending(false); }
    }
  }

  async function requestConceptPage(cursor: string | null) {
    if (busy.current || !active.current) return;
    busy.current = true;
    setPending(true);
    setFailure(null);
    try {
      const path = cursor === null ? '/me/concept-progress?limit=10' : `/me/concept-progress?limit=10&cursor=${encodeURIComponent(cursor)}`;
      const payload = await fetchJson(path);
      if (payload === null) return;
      const page = conceptProgressResponseSchema.parse(payload);
      const appended = appendConceptProgressPage(conceptsRef.current, page);
      conceptsRef.current = appended;
      setConcepts(appended);
      setNextCursor(page.nextCursor);
      setConceptsLoaded(true);
    } catch {
      if (active.current) setFailure('concept');
    } finally {
      if (active.current) { busy.current = false; setPending(false); }
    }
  }

  useEffect(() => {
    active.current = true;
    void requestInitial();
    return () => { active.current = false; };
  }, []);

  const leave = () => { active.current = false; onBack(); };
  const retry = () => failure === 'summary' ? void requestInitial() : void requestConceptPage(nextCursor);

  return <section className="panel progress" aria-labelledby="progress-title" aria-busy={pending}>
    <p className="eyebrow accent">{labels.eyebrow}</p>
    <h2 id="progress-title">{labels.title}</h2>
    <p className="panel-copy">{labels.description}</p>
    <button className="secondary" onClick={leave}>{labels.back}</button>
    <fieldset className="languages"><legend>{labels.language}</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="progress-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    {pending && progress === null && <div className="message" role="status"><span aria-hidden="true">◌</span><p>{labels.loading}</p></div>}
    {progress && <>
      <dl className="progress-summary" aria-label={labels.summary}>
        <div className="progress-metric"><dt>{labels.answered}</dt><dd>{progress.answered}</dd></div>
        <div className="progress-metric"><dt>{labels.correct}</dt><dd>{progress.correct}</dd></div>
        <div className="progress-metric"><dt>{labels.incorrect}</dt><dd>{progress.incorrect}</dd></div>
        <div className="progress-metric"><dt>{labels.accuracy}</dt><dd>{progress.accuracyPercent === null ? '—' : `${progress.accuracyPercent}%`}</dd></div>
      </dl>
      {conceptsLoaded && concepts.length === 0 && <p className="empty-progress" data-mastery-status="NOT_STARTED">{labels.empty}</p>}
      {concepts.length > 0 && <section aria-labelledby="concept-progress-title">
        <h3 id="concept-progress-title">{labels.concepts}</h3>
        <ul className="concept-progress-list">{concepts.map((item) => <li className="concept-progress-card" key={item.conceptId} data-concept-id={item.conceptId}>
          <div className="concept-progress-heading"><h4>{conceptName(item, language) || item.nameEnglish || item.slug}</h4><strong data-mastery-status={item.masteryStatus}>{labels[item.masteryStatus]}</strong></div>
          <span className="sr-only">{labels.mastery}: {labels[item.masteryStatus]}</span>
          <dl>
            <div><dt>{labels.practice}</dt><dd>{labels.answered}: {item.practice.answered}<br />{labels.correct}: {item.practice.correct}<br />{labels.incorrect}: {item.practice.incorrect}</dd></div>
            <div><dt>{labels.exam}</dt><dd>{labels.answered}: {item.exam.answered}<br />{labels.correct}: {item.exam.correct}<br />{labels.incorrect}: {item.exam.incorrect}</dd></div>
            <div><dt>{labels.total}</dt><dd>{labels.answered}: {item.total.answered}<br />{labels.correct}: {item.total.correct}<br />{labels.incorrect}: {item.total.incorrect}</dd></div>
            <div><dt>{labels.accuracy}</dt><dd>{item.total.accuracyPercent === null ? '—' : `${item.total.accuracyPercent}%`}</dd></div>
          </dl>
          <time dateTime={item.lastActivityAt}>{labels.lastActivity}: {new Date(item.lastActivityAt).toLocaleString()}</time>
        </li>)}</ul>
      </section>}
      {pending && progress !== null && <div className="message" role="status"><span aria-hidden="true">◌</span><p>{labels.loadingMore}</p></div>}
      {nextCursor !== null && failure === null && <button className="primary" disabled={pending} onClick={() => void requestConceptPage(nextCursor)}>{pending ? labels.waiting : labels.loadMore}</button>}
    </>}
    {failure && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>{failure === 'summary' ? labels.error : labels.conceptError}</p></div>}
    {failure && <button className="primary" disabled={pending} onClick={retry}>{pending ? labels.waiting : labels.retry}</button>}
  </section>;
}
