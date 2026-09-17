'use client';

import { useEffect, useRef, useState } from 'react';
import { favoriteResponseSchema, favoritesResponseSchema, type FavoriteItem, type Session } from '../lib/contracts';

type Language = 'English' | 'Russian' | 'Thai';

const localized = (language: Language, english: string | null, russian: string | null, thai: string | null) =>
  (language === 'Russian' ? russian : language === 'Thai' ? thai : english) || english;

function readableTime(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function Favorites({ session, onBack, onExpired }: { session: Session; onBack: () => void; onExpired: () => void }) {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('English');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removeErrors, setRemoveErrors] = useState<Set<string>>(new Set());
  const feedBusy = useRef(false);
  const removeBusy = useRef(new Set<string>());
  const active = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  async function request(cursor: string | null) {
    if (feedBusy.current || !active.current) return;
    feedBusy.current = true;
    setPending(true);
    setError(false);
    try {
      const query = cursor === null ? '/me/favorites?limit=10' : `/me/favorites?limit=10&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(query, {
        method: 'GET', headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const page = favoritesResponseSchema.parse(payload);
      const presentationIds = new Set(itemsRef.current.map((item) => item.presentationId.toLowerCase()));
      const questionIds = new Set(itemsRef.current.map((item) => item.question.id.toLowerCase()));
      for (const item of page.items) {
        const presentationId = item.presentationId.toLowerCase();
        const questionId = item.question.id.toLowerCase();
        if (presentationIds.has(presentationId) || questionIds.has(questionId)) throw new Error();
        presentationIds.add(presentationId);
        questionIds.add(questionId);
      }
      const updated = cursor === null ? page.items : [...itemsRef.current, ...page.items];
      itemsRef.current = updated;
      setItems(updated);
      setNextCursor(page.nextCursor);
      setRetryCursor(null);
    } catch {
      if (active.current) { setError(true); setRetryCursor(cursor); }
    } finally {
      if (active.current) { feedBusy.current = false; setPending(false); }
    }
  }

  async function remove(item: FavoriteItem) {
    const presentationId = item.presentationId;
    if (!active.current || removeBusy.current.has(presentationId)) return;
    removeBusy.current.add(presentationId);
    setRemoving(new Set(removeBusy.current));
    setRemoveErrors((current) => {
      const updated = new Set(current);
      updated.delete(presentationId);
      return updated;
    });
    try {
      const response = await fetch('/practice/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ presentationId, favorite: false }),
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!active.current) return;
      if (response.status === 401) { active.current = false; onExpired(); return; }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current) return;
      const result = favoriteResponseSchema.parse(payload);
      if (result.presentationId !== presentationId || result.favorite !== false) throw new Error();
      const updated = itemsRef.current.filter((candidate) => candidate.presentationId !== presentationId);
      itemsRef.current = updated;
      setItems(updated);
    } catch {
      if (active.current) setRemoveErrors((current) => new Set(current).add(presentationId));
    } finally {
      removeBusy.current.delete(presentationId);
      if (active.current) setRemoving(new Set(removeBusy.current));
    }
  }

  useEffect(() => {
    active.current = true;
    void request(null);
    return () => { active.current = false; };
  }, []);

  const leave = () => { active.current = false; onBack(); };

  return <section className="panel favorites" aria-labelledby="favorites-title" aria-busy={pending}>
    <p className="eyebrow accent">03 / SAVED FOR LATER</p>
    <h2 id="favorites-title">Favorites</h2>
    <p className="panel-copy">Review the exact question snapshots you saved during practice.</p>
    <button className="secondary" onClick={leave}>Back</button>
    <fieldset className="languages"><legend>Favorites language</legend>{(['English', 'Russian', 'Thai'] as const).map((item) => <label key={item}><input type="radio" name="favorites-language" checked={language === item} onChange={() => setLanguage(item)} /> {item}</label>)}</fieldset>
    {pending && items.length === 0 && <div className="message" role="status"><span aria-hidden="true">◌</span><p>Loading your favorites…</p></div>}
    {!pending && !error && items.length === 0 && nextCursor === null && <div className="empty-history empty-favorites"><p>You have no saved favorites yet. Save a question during practice and it will appear here.</p><button className="primary" onClick={leave}>Back</button></div>}
    {items.length > 0 && <div className="favorites-list">{items.map((item) => <article className="favorite-entry" key={item.presentationId}>
      <time dateTime={item.favoritedAt}>{readableTime(item.favoritedAt)}</time>
      <h3>{localized(language, item.question.textEnglish, item.question.textRussian, item.question.textThai)}</h3>
      {item.question.textExamEnglish && <details><summary>Exam English wording</summary><p>{item.question.textExamEnglish}</p></details>}
      <ol className="favorite-choices" aria-label="Favorite question choices">{item.question.choices.map((choice) => <li key={choice.id}><strong>{choice.key}.</strong> {localized(language, choice.textEnglish, choice.textRussian, choice.textThai)}</li>)}</ol>
      {removeErrors.has(item.presentationId) && <p className="inline-error" role="alert">We could not remove this favorite. Check your connection and retry.</p>}
      <button className="secondary remove-favorite" disabled={removing.has(item.presentationId)} onClick={() => void remove(item)}>{removing.has(item.presentationId) ? 'Removing…' : removeErrors.has(item.presentationId) ? 'Retry removal' : 'Remove'}</button>
    </article>)}</div>}
    {error && <div className="message error" role="alert"><span aria-hidden="true">!</span><p>We could not load your favorites. Check your connection and retry.</p></div>}
    {error && <button className="primary" disabled={pending} onClick={() => void request(retryCursor)}>{pending ? 'Please wait…' : 'Retry favorites'}</button>}
    {!error && nextCursor !== null && <button className="primary next" disabled={pending} onClick={() => void request(nextCursor)}>{pending ? 'Loading more…' : 'Load more'}</button>}
  </section>;
}
