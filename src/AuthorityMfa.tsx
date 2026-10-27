import { useEffect, useMemo, useRef, useState } from "react";
import { getMultiFactorResolver, multiFactor, PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier, signOut, type MultiFactorError, type User } from "firebase/auth";
import { ShieldCheck } from "lucide-react";
import { auth } from "./firebase";

export function MfaSignIn({ error, close }: { error: MultiFactorError; close: () => void }) {
  const resolver = useMemo(() => getMultiFactorResolver(auth, error), [error]);
  const factors = resolver.hints.filter(factor => factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID);
  const [factorIndex, setFactorIndex] = useState(0);
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const verifier = useRef<RecaptchaVerifier>();
  useEffect(() => () => verifier.current?.clear(), []);
  async function send() {
    setBusy(true); setNotice("");
    try {
      verifier.current?.clear();
      verifier.current = new RecaptchaVerifier(auth, "mfa-signin-recaptcha", { size: "normal" });
      const id = await new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: factors[factorIndex], session: resolver.session }, verifier.current);
      setVerificationId(id); setNotice("Verification code sent to your enrolled phone.");
    } catch { setNotice("The code could not be sent. Check the verification challenge and try again."); }
    finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setNotice("");
    try {
      await resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code.trim())));
      close();
    } catch { setNotice("That code is invalid or expired. Try again or request a new code."); }
    finally { setBusy(false); }
  }
  return <main className="authority-login"><section className="authority-login-card mfa-card" aria-label="Multi-factor sign-in">
    <ShieldCheck size={38} /><h1>Verify your account</h1><p>Complete multi-factor sign-in using your enrolled phone.</p>
    {factors.length > 1 && <label>Verification phone<select value={factorIndex} onChange={event => { setFactorIndex(Number(event.target.value)); setVerificationId(""); }}>{factors.map((factor, index) => <option key={factor.uid} value={index}>{factor.displayName || `Enrolled phone ${index + 1}`}</option>)}</select></label>}
    <div id="mfa-signin-recaptcha" />
    {verificationId && <label>Verification code<input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Multi-factor verification code" /></label>}
    {notice && <p role="status">{notice}</p>}
    {!factors.length ? <p role="alert">This account has no supported SMS factor. Contact your account administrator.</p> : verificationId ? <><button disabled={busy || !/^\d{6}$/.test(code)} onClick={() => void verify()}>Verify and sign in</button><button className="quiet" disabled={busy} onClick={() => void send()}>Send a new code</button></> : <button disabled={busy} onClick={() => void send()}>Send verification code</button>}
    <button className="quiet" disabled={busy} onClick={close}>Cancel sign-in</button>
  </section></main>;
}

export default function AuthorityMfa({ user, enrolled }: { user: User; enrolled: boolean }) {
  const [phone, setPhone] = useState("+91 ");
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const verifier = useRef<RecaptchaVerifier>();
  useEffect(() => () => verifier.current?.clear(), []);
  async function send() {
    setBusy(true); setNotice("");
    try {
      verifier.current?.clear();
      verifier.current = new RecaptchaVerifier(auth, "authority-mfa-enroll-recaptcha", { size: "normal" });
      const session = await multiFactor(user).getSession();
      setVerificationId(await new PhoneAuthProvider(auth).verifyPhoneNumber({ phoneNumber: phone.replace(/\s/g, ""), session }, verifier.current));
      setNotice("Administrative verification code sent.");
    } catch { setNotice("Could not send the code. Use an India or Canada number, or sign in again if your session has expired."); }
    finally { setBusy(false); }
  }
  async function enroll() {
    setBusy(true); setNotice("");
    try {
      await multiFactor(user).enroll(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code.trim())), "Pawlytics authority phone");
      await signOut(auth); window.location.reload();
    } catch { setNotice("The MFA code could not be verified. Check the code and try again."); setBusy(false); }
  }
  return <main className="authority-login"><section className="authority-login-card mfa-card" aria-label="Authority account security">
    <ShieldCheck size={38} /><h1>{enrolled ? "Complete multi-factor sign-in" : "Secure your authority account"}</h1>
    <p>{enrolled ? "Sign out and sign in again to verify your enrolled authority factor." : "Administrative access requires an enrolled SMS second factor."}</p>
    {!enrolled && <><label>Phone number<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" aria-label="Authority MFA phone number" /></label><div id="authority-mfa-enroll-recaptcha" />{verificationId && <label>Verification code<input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Authority MFA verification code" /></label>}{verificationId ? <button disabled={busy || !/^\d{6}$/.test(code)} onClick={() => void enroll()}>Verify and enroll</button> : <button disabled={busy || !/^\+\d{8,15}$/.test(phone.replace(/\s/g, ""))} onClick={() => void send()}>Send verification code</button>}</>}
    {notice && <p role="status">{notice}</p>}
    <button className="quiet" disabled={busy} onClick={() => void signOut(auth)}>Sign out securely</button><a href="/">Return to citizen map</a>
  </section></main>;
}
