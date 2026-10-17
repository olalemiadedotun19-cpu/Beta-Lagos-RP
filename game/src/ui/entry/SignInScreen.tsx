import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, AtSign, Check, ChevronLeft, Eye, EyeOff, Loader2, Lock, Mail, UserRound } from 'lucide-react';
import {
  checkEmail,
  checkName,
  checkPassword,
  checkUsername,
  normalizeUsername,
  type Account,
  type AuthField,
} from '../../auth/AccountStore';
import { signInOrRegister } from '../../net/cloudAuth';
import betaLagosLogo from './beta-lagos-rp.webp';

interface SignInScreenProps {
  onSignedIn: (account: Account, isNew: boolean) => void;
  /** in-game "new life" only: back to the running game (the plain launch screen has nothing but the SIGN IN button) */
  onCancel?: () => void;
}

type FieldState = 'idle' | 'ok' | 'bad';

/**
 * Step 1 of the entry flow: ONE full-screen, landscape sign-in page that never scrolls.
 * - Left: the Beta Lagos RP logo over a Lagos dusk skyline.
 * - Right: the login form (name shown above your head, private username, password, optional email) laid out as a 2 x 2 grid so it fits
 *   short landscape phone screens. A username that does not exist yet is created on the spot, an existing one is checked against its
 *   password (net/cloudAuth.ts: Firebase accounts, or local ones until Firebase is configured).
 * - Sizes are driven by the screen height (dvh), so the whole page scales down instead of scrolling.
 * - Always landscape: the orientation is locked where the browser allows it, and a touch device that is still held upright shows the same page turned 90deg (see entry.css), so portrait never appears.
 */

/** [x, width, height] of the skyline blocks, in a 400 x 90 box */
const SKYLINE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 26, 34], [26, 18, 52], [44, 30, 40], [74, 16, 66], [90, 24, 46], [114, 20, 30], [134, 28, 58], [162, 22, 38], [184, 14, 74],
  [198, 26, 48], [224, 20, 36], [244, 30, 62], [274, 18, 44], [292, 26, 32], [318, 16, 56], [334, 28, 42], [362, 20, 68], [382, 18, 36],
];
/** a few lit windows, picked by a fixed pattern so the skyline looks the same every time */
const WINDOWS: Array<{ x: number; y: number }> = [];
SKYLINE.forEach(([x, w, h], i) => {
  for (let row = 0; row < Math.floor((h - 6) / 7); row++) {
    for (let col = 0; col < Math.floor((w - 4) / 6); col++) {
      if ((i * 7 + row * 3 + col * 5) % 6 === 0) WINDOWS.push({ x: x + 4 + col * 6, y: 90 - h + 6 + row * 7 });
    }
  }
});

export const SignInScreen: React.FC<SignInScreenProps> = ({ onSignedIn, onCancel }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ field: AuthField; message: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);

  // landscape only: lock it where the browser allows (installed app / fullscreen); everywhere else entry.css turns the page 90deg on an upright touch screen
  useEffect(() => {
    const o = (typeof screen !== 'undefined' ? screen.orientation : undefined) as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    o?.lock?.('landscape').catch(() => undefined);
  }, []);

  // keyboard devices start typing straight away; on a phone the on-screen keyboard would cover the page, so wait for a tap
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const t = window.setTimeout(() => nameRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);

  const nameErr = checkName(name);
  const emailErr = checkEmail(email);
  const userErr = checkUsername(username);
  const passErr = checkPassword(password);

  const stateOf = (field: AuthField, value: string, err: string): FieldState => {
    if (serverError?.field === field) return 'bad';
    if (!err) return 'ok';
    return value.length > 0 || attempted ? 'bad' : 'idle';
  };
  const messageOf = (field: AuthField, err: string): string => (serverError?.field === field ? serverError.message : err);

  const clearServer = (): void => setServerError(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setAttempted(true);
    setServerError(null);
    if (nameErr || emailErr || userErr || passErr) {
      (nameErr ? nameRef : userErr ? userRef : passErr ? passRef : emailRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await signInOrRegister({ name, username, password, email });
      if (res.ok) {
        onSignedIn(res.account, res.isNew);
        return; // the screen is replaced by the showroom
      }
      setServerError({ field: res.field, message: res.message });
      (res.field === 'password' ? passRef : res.field === 'email' ? emailRef : res.field === 'username' ? userRef : nameRef).current?.focus();
    } catch (err) {
      console.error('Sign-in failed', err);
      setServerError({ field: 'password', message: `Something went wrong (${err instanceof Error ? err.message.slice(0, 120) : String(err)})` });
    }
    setBusy(false);
  };

  return (
    <div className="ef-root si-root" role="main">
      <section className="si-brand">
        <div className="si-sky" aria-hidden="true" />
        <div className="si-glow" aria-hidden="true" />
        <svg className="si-skyline" viewBox="0 0 400 90" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <g fill="#06080c">
            {SKYLINE.map(([x, w, h]) => (
              <rect key={x} x={x} y={90 - h} width={w} height={h} />
            ))}
          </g>
          <g fill="#f2c14e" opacity="0.55">
            {WINDOWS.map((win) => (
              <rect key={`${win.x}-${win.y}`} x={win.x} y={win.y} width="2.4" height="3" />
            ))}
          </g>
        </svg>
        <img className="si-logo" src={betaLagosLogo} alt="Beta Lagos RP" draggable={false} />
        <p className="si-game">International Life</p>
        {onCancel && (
          <button type="button" className="si-back" onClick={onCancel} disabled={busy}>
            <ChevronLeft size={18} /> Back to game
          </button>
        )}
      </section>

      <form className="si-form" onSubmit={submit} noValidate aria-labelledby="si-title">
        <div className="si-form-inner">
          <h1 id="si-title" className="si-title">Sign in</h1>
          <p className="si-sub">A new username creates your account.</p>

          <div className="si-grid">
            <Field
              label="Name"
              icon={<UserRound size={17} />}
              state={stateOf('name', name, nameErr)}
              message={messageOf('name', nameErr)}
              hint="Shown above your head"
            >
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); clearServer(); }}
                placeholder="Adebayo Okafor"
                autoComplete="name"
                autoCapitalize="words"
                autoCorrect="off"
                enterKeyHint="next"
                maxLength={60}
              />
            </Field>

            <Field
              label="Username"
              icon={<AtSign size={17} />}
              state={stateOf('username', username, userErr)}
              message={messageOf('username', userErr)}
              hint="Private, only for signing in"
            >
              <input
                ref={userRef}
                type="text"
                value={username}
                onChange={(e) => { setUsername(normalizeUsername(e.target.value).replace(/\s/g, '')); clearServer(); }}
                placeholder="your_username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                maxLength={20}
              />
            </Field>

            <Field
              label="Password"
              icon={<Lock size={17} />}
              state={stateOf('password', password, passErr)}
              message={messageOf('password', passErr)}
              hint="At least 6 characters"
              trailing={
                <button
                  type="button"
                  className="si-eye"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              }
            >
              <input
                ref={passRef}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearServer(); }}
                placeholder="••••••••"
                autoComplete="current-password"
                enterKeyHint="next"
                maxLength={64}
              />
            </Field>

            <Field
              label="Email (optional)"
              icon={<Mail size={17} />}
              state={email.trim() ? stateOf('email', email, emailErr) : serverError?.field === 'email' ? 'bad' : 'idle'}
              message={messageOf('email', emailErr)}
              hint="For recovering your account"
            >
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearServer(); }}
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={100}
              />
            </Field>
          </div>

          <button type="submit" className="si-submit" disabled={busy}>
            {busy ? (
              <><Loader2 size={18} className="ef-spin" /> Signing in</>
            ) : (
              <>Sign in <ArrowRight size={18} /></>
            )}
          </button>
        </div>
      </form>

    </div>
  );
};

const Field: React.FC<{
  label: string;
  icon: React.ReactNode;
  state: FieldState;
  message: string;
  hint: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, icon, state, message, hint, trailing, children }) => (
  <label className="si-field" data-state={state}>
    <span className="si-label">{label}</span>
    <span className="si-input">
      <span className="si-input-icon" aria-hidden="true">{icon}</span>
      {children}
      {trailing}
      {state === 'ok' && !trailing && <Check size={15} className="si-ok" aria-hidden="true" />}
    </span>
    {state === 'bad' ? (
      <span className="si-msg si-msg-bad" role="alert"><AlertCircle size={13} /> {message}</span>
    ) : (
      <span className="si-msg">{hint}</span>
    )}
  </label>
);
