'use client';

import { useEffect, useRef, useState } from 'react';
import { reminderPreferenceSchema, type Session } from '../lib/contracts';

type Failure = 'load' | 'save' | null;

export function Reminders({ session, onBack, onExpired }: {
  session: Session;
  onBack: () => void;
  onExpired: () => void;
}) {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<Failure>(null);
  const [message, setMessage] = useState('Loading your reminder preference…');
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
    setMessage('Loading your reminder preference…');
    try {
      const response = await fetch('/me/reminders', {
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
      const preference = reminderPreferenceSchema.parse(payload);
      setConfirmed(preference.dailyQuestionReminderEnabled);
      setMessage(preference.dailyQuestionReminderEnabled
        ? 'Your saved preference is enabled.'
        : 'Your saved preference is disabled.');
    } catch {
      if (active.current && id === requestId.current) {
        setFailure('load');
        setMessage('We could not load your reminder preference. Check your connection and retry.');
      }
    } finally {
      if (id === requestId.current) {
        busy.current = false;
        if (active.current) setPending(false);
      }
    }
  }

  async function savePreference(requested: boolean) {
    if (busy.current || !active.current || confirmed === null || requested === confirmed) return;
    const id = ++requestId.current;
    busy.current = true;
    setPending(true);
    setFailure(null);
    setMessage('Saving your reminder preference…');
    try {
      const response = await fetch('/me/reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ dailyQuestionReminderEnabled: requested }),
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
      const preference = reminderPreferenceSchema.parse(payload);
      if (preference.dailyQuestionReminderEnabled !== requested) throw new Error();
      setConfirmed(preference.dailyQuestionReminderEnabled);
      setMessage(preference.dailyQuestionReminderEnabled
        ? 'Preference saved: daily-question reminders enabled.'
        : 'Preference saved: daily-question reminders disabled.');
    } catch {
      if (active.current && id === requestId.current) {
        setFailure('save');
        setMessage('We could not confirm your reminder preference was saved. Your last confirmed choice is still shown. Please retry.');
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

  return <section className="panel reminders" aria-labelledby="reminders-title" aria-busy={pending}>
    <p className="eyebrow accent">REMINDER PREFERENCE</p>
    <h2 id="reminders-title">Reminder settings</h2>
    <p className="panel-copy">Record whether you would like a daily-question reminder.</p>
    <button className="secondary" onClick={leave}>Back</button>
    <div className="reminder-notice">
      <strong>Daily questions in Telegram</strong>
      <p>Enable this preference to receive a question in your private bot chat at 11:00 Thailand time. Choose a vehicle for English and Russian questions. Saving does not send a message immediately.</p>
    </div>
    {confirmed !== null && <label className="reminder-control">
      <input
        type="checkbox"
        checked={confirmed}
        disabled={pending}
        onChange={() => void savePreference(!confirmed)}
      />
      <span>Daily-question reminder preference</span>
    </label>}
    <div className={`message ${failure ? 'error' : ''}`} role={failure ? 'alert' : 'status'}>
      <span aria-hidden="true">{pending ? '◌' : failure ? '!' : '✓'}</span><p>{message}</p>
    </div>
    {failure === 'load' && <button className="primary" disabled={pending} onClick={() => void loadPreference()}>
      Retry reminder settings<span aria-hidden="true">↗</span>
    </button>}
    {failure === 'save' && confirmed !== null && <button className="primary" disabled={pending} onClick={() => void savePreference(!confirmed)}>
      Retry saving<span aria-hidden="true">↗</span>
    </button>}
  </section>;
}
