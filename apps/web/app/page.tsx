'use client';

import { useEffect, useRef, useState } from 'react';
import { loginSchema, userSchema, type Session, type Vehicle } from '../lib/contracts';
import { History } from './history';
import { Practice } from './practice';
import { Favorites } from './favorites';
import { loadTelegram } from '../lib/telegram';

const labels: Record<Vehicle, string> = { CAR: 'Car', MOTORCYCLE: 'Motorcycle' };
type View = 'setup' | 'practice' | 'history' | 'mistakes' | 'favorites';

function VehicleArt({ vehicle }: { vehicle: Vehicle }) {
  return <svg viewBox="0 0 160 80" fill="none" aria-hidden="true">
    <path d="M8 66h144" stroke="currentColor" opacity=".2" strokeWidth="2" />
    {vehicle === 'CAR' ? <g stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
      <path d="m28 46 12-23h54l22 23 20 4v13H22V50l6-4Z" fill="#e7e9d8" />
      <path d="m49 30-7 16h61L88 30H49ZM70 30v16" />
      <circle cx="45" cy="62" r="10" fill="#f5f3eb" /><circle cx="115" cy="62" r="10" fill="#f5f3eb" />
    </g> : <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="38" cy="58" r="17" /><circle cx="121" cy="58" r="17" />
      <path d="m38 58 24-28 20 28H38Zm44 0 22-26 17 26M99 20h10l12 38M55 28h23M70 35h25l-8 13H70" fill="#e7e9d8" />
    </g>}
  </svg>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [choice, setChoice] = useState<Vehicle | null>(null);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState('Connecting to Telegram…');
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const [view, setView] = useState<View>('setup');
  const [feedReturn, setFeedReturn] = useState<'setup' | 'practice'>('setup');

  async function authenticate() {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(false); setMessage('Connecting to Telegram…');
    try {
      const telegram = await loadTelegram();
      telegram.ready();
      if (!telegram.initData.trim()) {
        setError(true); setMessage('Open ThaiDLT from the Mini App button in Telegram. Then return here to try again.');
        return;
      }
      setMessage('Signing you in securely…');
      const response = await fetch('/auth/telegram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: telegram.initData }), cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401) {
        setError(true); setMessage('Your Telegram sign-in has expired. Close and reopen ThaiDLT in Telegram, then try again.');
        return;
      }
      if (!response.ok) throw new Error();
      const authenticated = loginSchema.parse(await response.json());
      if (Date.parse(authenticated.expiresAt) <= Date.now()) throw new Error();
      setSession(authenticated); setChoice(authenticated.user.selectedVehicleType);
      setMessage(authenticated.user.selectedVehicleType ? `Saved selection: ${labels[authenticated.user.selectedVehicleType]}.` : 'Choose the vehicle you are preparing to drive.');
    } catch {
      setError(true); setMessage('We could not connect. Check your connection and try again, or reopen ThaiDLT from Telegram.');
    } finally { busy.current = false; setPending(false); }
  }

  useEffect(() => { void authenticate(); }, []);

  async function save() {
    if (busy.current || !session || !choice) return;
    busy.current = true; setPending(true); setError(false); setMessage('Saving your selection…');
    try {
      const response = await fetch('/me/vehicle', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ vehicleType: choice }), cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401) {
        setSession(null); setChoice(null); setError(true);
        setMessage('Your session has ended. Close and reopen ThaiDLT in Telegram, then try again.');
        return;
      }
      if (!response.ok) throw new Error();
      const user = userSchema.parse(await response.json());
      if (user.id !== session.user.id || user.selectedVehicleType !== choice) throw new Error();
      setSession({ ...session, user }); setMessage(`Saved selection: ${labels[choice]}. You can change it any time.`);
    } catch {
      setError(true); setMessage('We could not confirm your selection was saved. Showing your last confirmed choice. Please try again.');
    } finally { busy.current = false; setPending(false); }
  }

  return <main className="mx-auto flex min-h-svh max-w-5xl flex-col px-5 py-7 sm:px-10 sm:py-10">
    <header className="flex items-center justify-between gap-4">
      <a className="brand" href="/" aria-label="ThaiDLT home"><span className="brand-mark" aria-hidden="true">↗</span> Thai<span className="font-normal">DLT</span></a>
      <span className="eyebrow">THEORY · THAILAND</span>
    </header>
    <div className="onboarding-grid">
      <section className="intro">
        <p className="eyebrow accent">YOUR ROAD STARTS HERE</p>
        <h1>A little practice.<br />A clearer road.</h1>
        <p className="intro-copy">Make sense of Thai driving theory, one step at a time.</p>
        <div className="road-art" aria-hidden="true"><span className="sun" /><div className="road"><i /><i /><i /></div><span className="road-caption">THAILAND, AHEAD ↗</span></div>
      </section>
      {view === 'favorites' && session ? <Favorites key={session.token} session={session} onBack={() => setView(feedReturn)} onExpired={() => { setView('setup'); setSession(null); setChoice(null); setError(true); setMessage('Your session has ended. Close and reopen ThaiDLT in Telegram, then try again.'); }} /> : (view === 'history' || view === 'mistakes') && session ? <History key={`${session.token}:${view}`} kind={view} session={session} onBack={() => setView(feedReturn)} onExpired={() => { setView('setup'); setSession(null); setChoice(null); setError(true); setMessage('Your session has ended. Close and reopen ThaiDLT in Telegram, then try again.'); }} /> : view === 'practice' && session ? <Practice key={`${session.token}:${session.user.selectedVehicleType}`} session={session} onVehicle={(missing) => { if (missing) setSession({ ...session, user: { ...session.user, selectedVehicleType: null } }); setView('setup'); setChoice(null); setMessage('Choose and save your vehicle to continue.'); }} onHistory={() => { setFeedReturn('practice'); setView('history'); }} onMistakes={() => { setFeedReturn('practice'); setView('mistakes'); }} onFavorites={() => { setFeedReturn('practice'); setView('favorites'); }} onExpired={() => { setView('setup'); setSession(null); setChoice(null); setError(true); setMessage('Your session has ended. Close and reopen ThaiDLT in Telegram, then try again.'); }} /> : <section className="panel" aria-labelledby="onboarding-title" aria-busy={pending}>
        <p className="eyebrow accent">01 / GET STARTED</p>
        <h2 id="onboarding-title">{session ? 'What will you drive?' : pending ? 'Welcome to ThaiDLT' : 'Let’s get you connected'}</h2>
        <p className="panel-copy">{session ? 'Choose your vehicle to make this journey yours.' : 'Start inside Telegram for a simple, secure sign-in.'}</p>
        {session && <>
          <fieldset disabled={pending}><legend className="sr-only">Vehicle type</legend>
            <div className="vehicle-options">{(['CAR', 'MOTORCYCLE'] as const).map((vehicle) => <label key={vehicle} className={`vehicle-card ${choice === vehicle ? 'selected' : ''}`}>
              <input type="radio" name="vehicle" value={vehicle} checked={choice === vehicle} onChange={() => setChoice(vehicle)} />
              <VehicleArt vehicle={vehicle} /><span>{labels[vehicle]}</span>
            </label>)}</div>
          </fieldset>
          <p className="saved">Saved selection: <strong>{session.user.selectedVehicleType ? labels[session.user.selectedVehicleType] : 'Not chosen yet'}</strong></p>
        </>}
        <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span aria-hidden="true">{pending ? '◌' : error ? '!' : '✓'}</span><p>{message}</p></div>
        {session ? <button className="primary" onClick={() => void save()} disabled={pending || !choice || choice === session.user.selectedVehicleType}>{pending ? 'Saving…' : choice === session.user.selectedVehicleType ? 'Selection saved' : 'Save vehicle'}<span aria-hidden="true">↗</span></button> : <button className="primary" onClick={() => void authenticate()} disabled={pending}>{pending ? 'Connecting…' : 'Try again'}<span aria-hidden="true">↗</span></button>}
        {session && <div className="panel-nav setup-links"><button className="secondary" disabled={pending} onClick={() => { setFeedReturn('setup'); setView('history'); }}>History</button><button className="secondary" disabled={pending} onClick={() => { setFeedReturn('setup'); setView('mistakes'); }}>Mistakes</button><button className="secondary" disabled={pending} onClick={() => { setFeedReturn('setup'); setView('favorites'); }}>Favorites</button></div>}
        {session?.user.selectedVehicleType && choice === session.user.selectedVehicleType && <button className="primary next" disabled={pending} onClick={() => setView('practice')}>Start practice</button>}
        <p className="footnote">{session ? 'Connected with Telegram' : 'No email. No password. Just Telegram.'}</p>
      </section>}
    </div>
    <footer className="flex flex-wrap justify-between gap-3"><span>ThaiDLT · Understand the road.</span><span>Made for your next chapter.</span></footer>
  </main>;
}


