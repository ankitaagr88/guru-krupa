import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { intake as intakeApi, reception as receptionApi, visits as visitsApi, errorMessage } from '../../api';
import { ageFromDob, ageSexLabel, dobProblem, fmtDob, localIso, MAX_AGE_YEARS, phoneKey } from '../../lib/format';
import { HOSPITAL_PRINT } from '../Prescription/hospital';
import { LANGUAGES, numOrNull, referralNeedsDetail } from '../Queue/queueModel';
import { UI_LANGS, listLabel, t as tr } from './strings';
import '../Patient/patient.css'; // the same-phone panel
import './register.css';

/* New patient form (/register). One page, two uses:
   - PUBLIC, no sign-in: a patient scans the QR poster at the front desk and fills it on their own
     phone, in English / Gujarati / Hindi. On send they are put in today's queue at the first
     stage (the visit note tells reception to check the details) and see their token number.
   - STAFF, signed in: the person at the desk fills the same questions for a patient who can't.
     The same-phone check (as on "New patient") offers "Use this patient"; after sending, the form
     is empty again for the next person.
   The questions are the reception "New patient" form's; the lists come from Admin. Every word is
   in ./strings.js. */

const LANG_KEY = 'gk_register_lang';
const SEX_OPTIONS = [
  { key: 'F', label: 'sexF' },
  { key: 'M', label: 'sexM' },
  { key: 'O', label: 'sexO' },
];

const EMPTY = {
  name: '',
  phone: '',
  dob: '',
  age: '',
  sex: null,
  address: '',
  occupation: '',
  screenHours: '',
  existingConditions: [],
  conditionOther: '',
  language: null,
  referralSource: 'self',
  referralDetail: '',
  elsewhere: null,
  elsewhereNote: '',
  website: '', // honeypot: hidden, only bots fill it in
};

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return UI_LANGS.some((l) => l.key === v) ? v : null;
  } catch {
    return null;
  }
}

function saveLang(v) {
  try {
    localStorage.setItem(LANG_KEY, v);
  } catch {
    /* private window: fine */
  }
}

export default function Register() {
  const { currentUser } = useAuth();
  const staff = !!currentUser;
  const navigate = useNavigate();
  const toast = useToast();
  // Patients in Surat mostly read Gujarati (the WhatsApp intake starts in Gujarati too); staff get English.
  const [lang, setLangState] = useState(() => readLang() || (staff ? 'en' : 'gu'));
  const [lists, setLists] = useState({ referralSources: [], conditions: [] });
  const [d, setD] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // public: {token, name} -> thank-you screen
  const [lastAdded, setLastAdded] = useState(null); // staff: {name, token} banner
  const [same, setSame] = useState({ key: '', rows: [] });
  const [dismissed, setDismissed] = useState('');
  const [using, setUsing] = useState(null);
  const nameRef = useRef(null);

  // A staff sign-in that is confirmed after the first paint still starts in English.
  useEffect(() => {
    if (staff && !readLang()) setLangState('en');
  }, [staff]);

  const t = (key, vars) => tr(lang, key, vars);
  const setLang = (v) => {
    setLangState(v);
    saveLang(v);
  };

  const defaultSource = (sources) =>
    sources.some((r) => r.key === 'self') ? 'self' : sources[0]?.key || null;

  useEffect(() => {
    let alive = true;
    intakeApi
      .lists()
      .then((l) => {
        if (!alive) return;
        const next = { referralSources: l?.referralSources || [], conditions: l?.conditions || [] };
        setLists(next);
        setD((x) => ({ ...x, referralSource: defaultSource(next.referralSources) }));
      })
      .catch(() => {}); // the questions still work without the lists
    return () => {
      alive = false;
    };
  }, []);

  // Staff only: who is already registered with this number (never on the public page).
  const key = phoneKey(d.phone);
  useEffect(() => {
    if (!staff || key.length < 10 || typeof receptionApi?.samePhone !== 'function') return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      receptionApi
        .samePhone(key)
        .then((rows) => alive && setSame({ key, rows: Array.isArray(rows) ? rows : [] }))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [staff, key]);
  const matches = staff && key.length >= 10 && same.key === key && dismissed !== key ? same.rows : [];

  const set = (k, v) => {
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
    if (formError) setFormError('');
  };
  const needsDetail = d.referralSource ? referralNeedsDetail(lists.referralSources, d.referralSource) : false;

  const reset = () => {
    setD({ ...EMPTY, referralSource: defaultSource(lists.referralSources) });
    setErrors({});
    setFormError('');
    setSame({ key: '', rows: [] });
    setDismissed('');
    window.scrollTo?.({ top: 0 });
  };

  const registerExisting = async (m) => {
    if (m.visitId) {
      navigate(`/queue/${m.stage || 'reg'}?patient=${m.id}`);
      return;
    }
    setUsing(m.id);
    try {
      const v = await visitsApi.create({ patientId: m.id });
      toast.success(`${m.name} added to the queue`, v?.token ? `Token ${v.token}` : undefined);
      setLastAdded({ name: m.name, token: v?.token || '' });
      reset();
    } catch (err) {
      if (err?.response?.status === 409) toast.info(`${m.name} is already in today's queue`);
      else toast.error('Could not add to the queue', errorMessage(err));
    } finally {
      setUsing(null);
    }
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    const name = d.name.trim();
    const next = {};
    if (!name) next.name = t('errName');
    if (!staff && key.length < 10) next.phone = t('errPhone');
    if (dobProblem(d.dob)) next.dob = t('dobProblem');
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`reg-${Object.keys(next)[0]}`)?.focus?.();
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const res = await intakeApi.submit({
        name,
        phone: d.phone.trim(),
        dob: d.dob || null,
        age: d.dob ? null : numOrNull(d.age, { int: true }),
        sex: d.sex,
        address: d.address.trim(),
        occupation: d.occupation.trim(),
        screenHours: numOrNull(d.screenHours),
        language: d.language,
        elsewhere: d.elsewhere === true,
        elsewhereNote: d.elsewhere === true ? d.elsewhereNote.trim() : '',
        referralSource: d.referralSource,
        referralDetail: needsDetail ? d.referralDetail.trim() : '',
        existingConditions: d.existingConditions.slice(),
        conditionOther: d.conditionOther.trim(),
        website: d.website,
      });
      if (staff) {
        toast.success(`${name} added to the queue`, res?.token ? `Token ${res.token}` : undefined);
        setLastAdded({ name, token: res?.token || '' });
        reset();
        nameRef.current?.focus?.();
      } else {
        setDone({ token: res?.token || '', name: name.split(/\s+/)[0] });
        window.scrollTo?.({ top: 0 });
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) setFormError(t('errRate'));
      else setFormError(staff ? `${t('errGeneric')} (${errorMessage(err)})` : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const today = new Date();
  const maxIso = localIso(today);
  const minIso = `${today.getFullYear() - MAX_AGE_YEARS}${maxIso.slice(4)}`;
  const dobBad = !!dobProblem(d.dob, today);
  const worked = d.dob && !dobBad ? ageFromDob(d.dob, today) : null;
  const h = HOSPITAL_PRINT;

  return (
    <div className="reg-page" lang={lang}>
      <header className="reg-head">
        <span className="reg-logo">
          <img src={h.logo} alt={h.name} />
        </span>
        <div className="reg-langs" role="group" aria-label={t('languageSwitch')}>
          {UI_LANGS.map((l) => (
            <button
              key={l.key}
              type="button"
              lang={l.key}
              className={lang === l.key ? 'active' : ''}
              aria-pressed={lang === l.key}
              onClick={() => setLang(l.key)}
              data-testid={`reg-lang-${l.key}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </header>

      <main className="reg-main">
        {done ? (
          <section className="reg-thanks" aria-live="polite" data-testid="reg-thanks">
            <h1>{t('thanksTitle', { name: done.name })}</h1>
            <p className="reg-thanks-body">{t('thanksBody')}</p>
            <div className="reg-token-card">
              <span className="reg-token-label">{t('tokenLabel')}</span>
              <span className="reg-token" data-testid="reg-token">
                {done.token}
              </span>
              <span className="reg-token-help">{t('tokenHelp')}</span>
            </div>
            <button
              type="button"
              className="reg-btn-secondary"
              onClick={() => {
                setDone(null);
                reset();
              }}
            >
              {t('another')}
            </button>
          </section>
        ) : (
          <form className="reg-form" onSubmit={submit} noValidate>
            {staff && (
              <div className="reg-staff-bar" data-testid="reg-staff-bar">
                <span>
                  Staff entry · signed in as <b>{currentUser.name || currentUser.username}</b>
                </span>
                <button type="button" className="btn-ghost" onClick={() => navigate('/queue')}>
                  Back to queue
                </button>
              </div>
            )}
            {staff && lastAdded && (
              <p className="reg-last" role="status" data-testid="reg-last">
                {lastAdded.name} added to the queue
                {lastAdded.token && (
                  <>
                    {' · token '}
                    <b className="num">{lastAdded.token}</b>
                  </>
                )}
              </p>
            )}

            <p className="reg-hospital">
              {h.name}
              {lang !== 'en' && <span className="reg-hospital-local">{t('hospitalLocal')}</span>}
            </p>
            <h1 className="reg-title">{t('title')}</h1>
            <div className="reg-first-visit" role="note">
              <b>{t('firstVisitOnly')}</b> {t('beenBefore')}
            </div>
            <p className="reg-intro">{t('intro')}</p>

            <Question id="reg-name" label={t('qName')} needed={t('needed')} error={errors.name}>
              <input
                ref={nameRef}
                id="reg-name"
                className={`reg-input${errors.name ? ' error' : ''}`}
                placeholder={t('qNamePh')}
                value={d.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={120}
                autoComplete="name"
                aria-invalid={!!errors.name}
              />
            </Question>

            <Question
              id="reg-phone"
              label={t('qPhone')}
              needed={staff ? null : t('needed')}
              help={t('qPhoneHelp')}
              error={errors.phone}
            >
              <input
                id="reg-phone"
                className={`reg-input num${errors.phone ? ' error' : ''}`}
                value={d.phone}
                onChange={(e) => set('phone', e.target.value.replace(/[^\d+\-() .]/g, ''))}
                inputMode="tel"
                type="tel"
                maxLength={20}
                autoComplete="tel"
                aria-invalid={!!errors.phone}
              />
            </Question>
            {matches.length > 0 && (
              <div className="same-phone reg-same-phone" role="region" aria-label="Already registered with this number" data-testid="same-phone">
                <p className="same-phone-title">Already registered with this number: is it one of these?</p>
                {matches.map((m) => (
                  <div key={m.id} className="same-phone-row" data-testid={`same-phone-${m.id}`}>
                    <div className="same-phone-who">
                      <span className="same-phone-name">{m.name}</span>
                      <span className="same-phone-meta">
                        {ageSexLabel(m)}
                        {m.visitId
                          ? ` · in today's queue${m.token ? ` · ${m.token}` : ''}`
                          : m.lastVisitDate
                            ? ` · last visit ${fmtDob(String(m.lastVisitDate).slice(0, 10))}`
                            : ' · no visit yet'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => registerExisting(m)}
                      disabled={using != null || busy}
                    >
                      {m.visitId ? "Open today's visit" : using === m.id ? 'Adding…' : 'Use this patient'}
                    </button>
                  </div>
                ))}
                <button type="button" className="link-btn same-phone-no" onClick={() => setDismissed(key)}>
                  No, a new patient
                </button>
              </div>
            )}

            <div className="reg-q">
              <label className="reg-q-label" htmlFor="reg-dob">
                {t('qDob')}
              </label>
              <input
                type="date"
                id="reg-dob"
                className={`reg-input num reg-input-date${errors.dob || dobBad ? ' error' : ''}`}
                value={d.dob}
                min={minIso}
                max={maxIso}
                onChange={(e) => set('dob', e.target.value)}
              />
              {worked != null && <p className="reg-help">{t('ageFromDob', { age: worked })}</p>}
              {(errors.dob || dobBad) && (
                <p className="reg-error" role="alert">
                  {t('dobProblem')}
                </p>
              )}
              <label className="reg-sub" htmlFor="reg-age">
                <span>{t('qAge')}</span>
                <input
                  id="reg-age"
                  className="reg-input num reg-input-short"
                  placeholder={t('qAgePh')}
                  value={worked != null ? worked : d.age}
                  onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 3))}
                  inputMode="numeric"
                  disabled={worked != null}
                />
              </label>
            </div>

            <ChoiceQuestion
              label={t('qSex')}
              options={SEX_OPTIONS.map((o) => ({ key: o.key, label: t(o.label) }))}
              value={d.sex}
              onChange={(v) => set('sex', v)}
              testId="reg-sex"
            />

            <Question id="reg-address" label={t('qAddress')}>
              <textarea
                id="reg-address"
                className="reg-input"
                rows={2}
                placeholder={t('qAddressPh')}
                value={d.address}
                onChange={(e) => set('address', e.target.value)}
                maxLength={255}
                autoComplete="street-address"
              />
            </Question>

            <Question id="reg-occupation" label={t('qOccupation')}>
              <input
                id="reg-occupation"
                className="reg-input"
                placeholder={t('qOccupationPh')}
                value={d.occupation}
                onChange={(e) => set('occupation', e.target.value)}
                maxLength={120}
              />
            </Question>

            <Question id="reg-screen" label={t('qScreen')}>
              <input
                id="reg-screen"
                className="reg-input num reg-input-short"
                placeholder={t('qScreenPh')}
                value={d.screenHours}
                onChange={(e) => set('screenHours', e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric"
              />
            </Question>

            {lists.conditions.length > 0 && (
              <fieldset className="reg-q">
                <legend className="reg-q-label">{t('qConditions')}</legend>
                <p className="reg-help">{t('qConditionsHelp')}</p>
                <div className="reg-ticks">
                  {lists.conditions.map((c) => {
                    const on = d.existingConditions.includes(c);
                    return (
                      <label key={c} className={`reg-tick${on ? ' on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            set(
                              'existingConditions',
                              e.target.checked
                                ? [...new Set([...d.existingConditions, c])]
                                : d.existingConditions.filter((x) => x !== c)
                            )
                          }
                          data-testid={`reg-cond-${c}`}
                        />
                        <span>{listLabel(lang, c)}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="reg-sub" htmlFor="reg-condition-other">
                  <span>{t('qConditionOther')}</span>
                  <input
                    id="reg-condition-other"
                    className="reg-input"
                    value={d.conditionOther}
                    onChange={(e) => set('conditionOther', e.target.value)}
                    maxLength={120}
                  />
                </label>
              </fieldset>
            )}

            <ChoiceQuestion
              label={t('qLanguage')}
              options={LANGUAGES}
              value={d.language}
              onChange={(v) => set('language', v)}
              testId="reg-pref-lang"
            />

            {lists.referralSources.length > 0 && (
              <fieldset className="reg-q">
                <legend className="reg-q-label">{t('qHeard')}</legend>
                <div className="reg-radios">
                  {lists.referralSources.map((r) => (
                    <label key={r.key} className={`reg-radio${d.referralSource === r.key ? ' on' : ''}`}>
                      <input
                        type="radio"
                        name="reg-referral"
                        value={r.key}
                        checked={d.referralSource === r.key}
                        onChange={() => set('referralSource', r.key)}
                        data-testid={`reg-ref-${r.key}`}
                      />
                      <span>{listLabel(lang, r.label)}</span>
                    </label>
                  ))}
                </div>
                {needsDetail && (
                  <label className="reg-sub" htmlFor="reg-referral-detail">
                    <span>{d.referralSource === 'doctor' ? t('qReferrerDoctor') : t('qReferrer')}</span>
                    <input
                      id="reg-referral-detail"
                      className="reg-input"
                      value={d.referralDetail}
                      onChange={(e) => set('referralDetail', e.target.value)}
                      maxLength={120}
                    />
                  </label>
                )}
              </fieldset>
            )}

            <ChoiceQuestion
              label={t('qElsewhere')}
              options={[
                { key: true, label: t('yes') },
                { key: false, label: t('no') },
              ]}
              value={d.elsewhere}
              onChange={(v) => set('elsewhere', v)}
              testId="reg-elsewhere"
            >
              {d.elsewhere === true && (
                <>
                  <textarea
                    id="reg-elsewhere-note"
                    className="reg-input"
                    rows={2}
                    aria-label={t('qElsewhereNote')}
                    placeholder={t('qElsewhereNote')}
                    value={d.elsewhereNote}
                    onChange={(e) => set('elsewhereNote', e.target.value)}
                    maxLength={500}
                  />
                  <p className="reg-help">{t('elsewhereBring')}</p>
                </>
              )}
            </ChoiceQuestion>

            {/* Honeypot: off-screen and skipped by keyboard and screen readers; people never fill it. */}
            <div className="reg-hp" aria-hidden="true">
              <label>
                Website
                <input
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={d.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </label>
            </div>

            {formError && (
              <p className="reg-form-error" role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className="reg-submit" disabled={busy} data-testid="reg-submit">
              {busy ? t('submitting') : staff ? 'Add to queue' : t('submit')}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

function Question({ id, label, needed, help, error, children }) {
  return (
    <div className="reg-q">
      <label className="reg-q-label" htmlFor={id}>
        {label}
        {needed && <span className="reg-needed">{needed}</span>}
      </label>
      {help && <p className="reg-help">{help}</p>}
      {children}
      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Big tap-to-choose buttons (one answer); tapping the chosen one again clears it. */
function ChoiceQuestion({ label, options, value, onChange, testId, children }) {
  return (
    <fieldset className="reg-q">
      <legend className="reg-q-label">{label}</legend>
      <div className="reg-choices">
        {options.map((o) => (
          <button
            key={String(o.key)}
            type="button"
            className={value === o.key ? 'on' : ''}
            aria-pressed={value === o.key}
            onClick={() => onChange(value === o.key ? null : o.key)}
            data-testid={`${testId}-${o.key}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {children}
    </fieldset>
  );
}
