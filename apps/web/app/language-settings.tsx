'use client';

import { useEffect, useRef, useState } from 'react';
import { languagePreferenceSchema, type PreferredLanguage, type Session } from '../lib/contracts';

type Failure = 'load' | 'save' | null;

const labels: Record<PreferredLanguage, string> = {
  ENGLISH: 'English',
  RUSSIAN: 'Russian',
  THAI: 'Thai',
};

const languages = ['ENGLISH', 'RUSSIAN', 'THAI'] as const;

export function LanguageSettings({ session, onBack, onExpired }: {
  session: Session;
  onBack: () => void;
  onExpired: () => void;
}) {
  const [confirmed, setConfirmed] = useState<PreferredLanguage | null>(null);
  const [selected, setSelected] = useState<PreferredLanguage | null>(null);
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<Failure>(null);
  const [message, setMessage] = useState('Loading your preferred language…');
  const active = useRef(true);
  const busy = useRef(false);
  const requestId = useRef(0);

  async function loadPreference() {
    if (busy.current || !active.current) return;
    const id = ++requestId.current;
    busy.current = true;
    setPending(true);
    setFailure(null);
    setConfirmed(null);
    setSelected(null);
    setMessage('Loading your preferred language…');
    try {
      const response = await fetch('/me/language', {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!active.current || id !== requestId.current) return;
      if (response.status === 401) {
        active.current = false;
        requestId.current++;
        onExpired();
        return;
      }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current || id !== requestId.current) return;
      const preference = languagePreferenceSchema.parse(payload);
      setConfirmed(preference.preferredLanguage);
      setSelected(preference.preferredLanguage);
      setMessage(`Saved language: ${labels[preference.preferredLanguage]}.`);
    } catch {
      if (active.current && id === requestId.current) {
        setFailure('load');
        setMessage('We could not load your preferred language. Check your connection and retry.');
      }
    } finally {
      if (id === requestId.current) {
        busy.current = false;
        if (active.current) setPending(false);
      }
    }
  }

  async function savePreference(requested: PreferredLanguage) {
    if (busy.current || !active.current || confirmed === null || requested === confirmed) return;
    const id = ++requestId.current;
    busy.current = true;
    setPending(true);
    setFailure(null);
    setMessage(`Saving ${labels[requested]}…`);
    try {
      const response = await fetch('/me/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ preferredLanguage: requested }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!active.current || id !== requestId.current) return;
      if (response.status === 401) {
        active.current = false;
        requestId.current++;
        onExpired();
        return;
      }
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!active.current || id !== requestId.current) return;
      const preference = languagePreferenceSchema.parse(payload);
      if (preference.preferredLanguage !== requested) throw new Error();
      setConfirmed(preference.preferredLanguage);
      setSelected(preference.preferredLanguage);
      setMessage(`Preference saved: ${labels[preference.preferredLanguage]}.`);
    } catch {
      if (active.current && id === requestId.current) {
        setFailure('save');
        setMessage(`We could not confirm your language was saved. Your last confirmed language is ${labels[confirmed]}. Please retry.`);
      }
    } finally {
      if (id === requestId.current) {
        busy.current = false;
        if (active.current) setPending(false);
      }
    }
  }

  useEffect(() => {
    active.current = true;
    void loadPreference();
    return () => {
      active.current = false;
      requestId.current++;
    };
  }, []);

  function leave() {
    active.current = false;
    requestId.current++;
    onBack();
  }

  return <section className="panel language-settings" aria-labelledby="language-settings-title" aria-busy={pending}>
    <p className="eyebrow accent">MESSAGE PREFERENCE</p>
    <h2 id="language-settings-title">Language settings</h2>
    <p className="panel-copy">Choose the language ThaiDLT should use for future messages.</p>
    <button className="secondary" onClick={leave}>Back</button>
    <div className="language-notice">
      <strong>This preference applies to future messages.</strong>
      <p>It does not change the separate language selectors in practice, history, progress or mock exams.</p>
    </div>
    {confirmed !== null && selected !== null && <fieldset className="language-preference" disabled={pending}>
      <legend>Preferred language</legend>
      {languages.map((language) => <label className={selected === language ? 'selected' : ''} key={language}>
        <input
          type="radio"
          name="preferred-language"
          value={language}
          checked={selected === language}
          onChange={() => {
            setSelected(language);
            setFailure(null);
            setMessage(language === confirmed
              ? `Saved language: ${labels[language]}.`
              : `Selected ${labels[language]}. Save to confirm this change.`);
          }}
        />
        <span>{labels[language]}</span>
      </label>)}
    </fieldset>}
    <div className={`message ${failure ? 'error' : ''}`} role={failure ? 'alert' : 'status'}>
      <span aria-hidden="true">{pending ? '◌' : failure ? '!' : '✓'}</span><p>{message}</p>
    </div>
    {failure === 'load' && <button className="primary" disabled={pending} onClick={() => void loadPreference()}>
      Retry language settings<span aria-hidden="true">↗</span>
    </button>}
    {confirmed !== null && selected !== null && <button
      className="primary"
      disabled={pending || selected === confirmed}
      onClick={() => void savePreference(selected)}
    >{failure === 'save' ? 'Retry saving' : selected === confirmed ? 'Preference saved' : 'Save language'}<span aria-hidden="true">↗</span></button>}
  </section>;
}
