import { useCallback, useEffect, useState } from 'react';
import { useTopbar, useShell } from '../../components/AppShell';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ROLES, ROLE_LABELS, useAuth } from '../../auth/AuthContext';
import { admin as adminApi, patients as patientsApi, onDataChange, errorMessage } from '../../api';
import { MedicinesSection } from './MedicinesAdmin';
import { TreatmentsSection } from './TreatmentsAdmin';
import { OtSlotsSection, OtProceduresSection, OtTeamRolesSection, OtPartnersSection } from './OtAdmin';
import { ImportSection } from './ImportAdmin';
import { ChargesSection } from './ChargesAdmin';
import { VisitFeesSection } from './VisitFeesAdmin';
import { RelationsSection } from './FamilyAdmin';
import { IntakeSection } from './IntakeAdmin';
import { DayBookAdminSections } from './DayBookAdmin';
import { RxPrintAdminSections } from './RxPrintAdmin';
import { EditableText, ReorderBtns } from './pieces';
import './admin.css';

/* Admin settings (mockup renderAdmin + addStage/renameStage/deleteStage,
   add/rename/delete/moveProtocolStep, add/rename/deleteReferralSource) plus
   lens tiers and staff (B9). Rows are addressed the way the real API does:
   stages / referral sources / lens tiers by `key`, protocol steps and staff by
   `id`. Reorder sends the full ordered list (PUT …/order). Medicines and medicine
   types (F12) live in MedicinesAdmin.jsx. */

const refOf = (row) => row.id ?? row.key;

export default function Admin() {
  const toast = useToast();
  const { refreshCounts } = useShell();
  const { currentUser } = useAuth();
  const [stages, setStages] = useState([]);
  const [steps, setSteps] = useState([]);
  const [sources, setSources] = useState([]);
  const [needsDetailKeys, setNeedsDetailKeys] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [showInactiveMeds, setShowInactiveMeds] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [staffModal, setStaffModal] = useState(false);
  const [pwFor, setPwFor] = useState(null);

  useTopbar({ sub: 'Process stages, dilation drops, referral sources, lens prices, OT slots, medicines, treatment standards and staff' });

  const load = useCallback(async () => {
    const safe = (p, fb = []) => p.catch(() => fb);
    const [st, ps, rs, nd, lt, sf, md] = await Promise.all([
      safe(adminApi.stages.list()),
      safe(adminApi.protocolSteps.list()),
      safe(adminApi.referralSources.list()),
      safe(patientsApi.referralNeedsDetail()),
      safe(adminApi.lensTiers.list()),
      safe(adminApi.staff.list()),
      safe(adminApi.medicines.list({ includeInactive: showInactiveMeds })),
    ]);
    setStages(st);
    setSteps(ps);
    setSources(rs);
    setNeedsDetailKeys(nd);
    setTiers(lt);
    setStaff(sf);
    setMedicines(md);
    setLoaded(true);
  }, [showInactiveMeds]);

  useEffect(() => {
    load();
    return onDataChange(load);
  }, [load]);

  /** Run a write, then refetch (real mode has no store subscription). */
  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) toast.success(okMsg, undefined, 2000);
      await load();
      refreshCounts?.();
      return true;
    } catch (err) {
      toast.error(
        err?.response?.status === 409 ? 'Not allowed right now' : 'Could not save',
        errorMessage(err)
      );
      await load();
      return false;
    }
  };

  const swap = (rows, i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return null;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  /* ---- stages ---- */
  const addStage = () =>
    run(async () => {
      const key = 'stage_' + Date.now().toString(36);
      await adminApi.stages.create({ key, label: 'New stage', cls: '' });
      // keep "Done" last, like the mockup's addStage (inserts before the final stage)
      const keys = stages.map((s) => s.key);
      if (keys.length && keys[keys.length - 1] === 'done') {
        keys.splice(keys.length - 1, 0, key);
        await adminApi.stages.reorder(keys);
      }
    });
  const renameStage = (s, label) =>
    label.trim() && label !== s.label && run(() => adminApi.stages.update(s.key, { label: label.trim() }));
  const moveStage = (i, dir) => {
    const next = swap(stages, i, dir);
    if (next) run(() => adminApi.stages.reorder(next.map((s) => s.key)));
  };
  const deleteStage = (s) => {
    if (stages.length <= 2) return toast.error('Keep at least two stages.');
    if (!window.confirm(`Remove the "${s.label}" stage?`)) return;
    run(() => adminApi.stages.remove(s.key), 'Stage removed');
  };

  /* ---- protocol steps ---- */
  const minutesOf = (d) => Number(d.minutes ?? d.min ?? 0);
  const addStep = () =>
    run(() =>
      adminApi.protocolSteps.create({ name: 'New drop ' + (steps.length + 1), minutes: 15, min: 15 })
    );
  const renameStep = (d, name) =>
    name.trim() &&
    name !== d.name &&
    run(() => adminApi.protocolSteps.update(refOf(d), { name: name.trim() }));
  const retimeStep = (d, val) => {
    const n = parseInt(val, 10);
    if (Number.isNaN(n) || n <= 0 || n === minutesOf(d)) return;
    run(() => adminApi.protocolSteps.update(refOf(d), { minutes: n, min: n }));
  };
  const moveStep = (i, dir) => {
    const next = swap(steps, i, dir);
    if (next) run(() => adminApi.protocolSteps.reorder(next.map(refOf)));
  };
  const deleteStep = (d) => {
    if (steps.length <= 1) return toast.error('Keep at least one step.');
    run(() => adminApi.protocolSteps.remove(refOf(d)));
  };

  /* ---- referral sources ---- */
  const needsDetail = (r) => r.needsDetail ?? needsDetailKeys.includes(r.key);
  const addSource = () =>
    run(() =>
      adminApi.referralSources.create({
        key: 'src_' + Date.now().toString(36),
        label: 'New source',
        needsDetail: false,
      })
    );
  const renameSource = (r, label) =>
    label.trim() &&
    label !== r.label &&
    run(() => adminApi.referralSources.update(r.key, { label: label.trim() }));
  const toggleDetail = (r) =>
    run(() => adminApi.referralSources.update(r.key, { needsDetail: !needsDetail(r) }));
  const deleteSource = (r) => {
    if (sources.length <= 1) return toast.error('Keep at least one referral source.');
    run(() => adminApi.referralSources.remove(r.key));
  };

  /* ---- lens tiers ---- */
  const addTier = () =>
    run(() =>
      adminApi.lensTiers.create({ key: 'lens_' + Date.now().toString(36), label: 'New lens', price: 0 })
    );
  const renameTier = (t, label) =>
    label.trim() &&
    label !== t.label &&
    run(() => adminApi.lensTiers.update(refOf(t), { label: label.trim() }));
  const repriceTier = (t, val) => {
    const n = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
    if (Number.isNaN(n) || n === Number(t.price)) return;
    run(() => adminApi.lensTiers.update(refOf(t), { price: n }));
  };
  const deleteTier = (t) => run(() => adminApi.lensTiers.remove(refOf(t)));

  /* ---- staff ---- */
  const setPhone = (u, phone) => run(() => adminApi.staff.update(u.id, { phone: phone.trim() }), 'Mobile saved');
  const setRole = (u, role) => run(() => adminApi.staff.update(u.id, { role }));
  const toggleActive = (u) => {
    if (u.id === currentUser?.id && u.active) return toast.error("You can't deactivate your own account.");
    run(
      () => adminApi.staff.update(u.id, { active: !u.active }),
      u.active ? `${u.name} deactivated` : `${u.name} reactivated`
    );
  };

  if (!loaded) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        Loading settings…
      </div>
    );
  }

  return (
    <div className="admin-wrap">
      <AdminIndex />
      {/* ---------------- stages ---------------- */}
      <section className="admin-block" aria-labelledby="h-stages">
        <h2 id="h-stages">Process stages</h2>
        <p className="hint">
          These are the columns staff move a patient through. Add, rename, reorder or remove a step — the
          queue board updates immediately. A stage with patients in it can&apos;t be removed.
        </p>
        <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              <th>Stage name</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody id="stageList">
            {stages.map((s, i) => (
              <tr key={s.key} data-testid={`stage-${s.key}`}>
                <td className="no-label">
                  <ReorderBtns i={i} n={stages.length} onMove={(dir) => moveStage(i, dir)} label={s.label} />
                </td>
                <td data-label="Stage name">
                  <EditableText
                    value={s.label}
                    onCommit={(v) => renameStage(s, v)}
                    ariaLabel={`Stage ${s.label}`}
                  />
                </td>
                <td className="no-label">
                  <button
                    className="admin-del"
                    onClick={() => deleteStage(s)}
                    aria-label={`Delete stage ${s.label}`}
                    type="button"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="admin-add" onClick={addStage} type="button">
          + Add a stage
        </button>
      </section>

      {/* ---------------- dilation protocol ---------------- */}
      <section className="admin-block" aria-labelledby="h-protocol">
        <h2 id="h-protocol">Dilation protocol (in order)</h2>
        <p className="hint">
          The exact sequence of drops for dilation, set by the doctor. Staff tick each one off as it&apos;s
          given — the timer for that step starts automatically, and the next step is suggested once it&apos;s
          done.
        </p>
        <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th style={{ width: 50 }}></th>
              <th>Drop name</th>
              <th style={{ width: 90 }}>Minutes</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody id="protocolList">
            {steps.map((d, i) => (
              <tr key={refOf(d) ?? i}>
                <td data-label="#">
                  <span className="step-order">{i + 1}</span>
                </td>
                <td className="no-label">
                  <ReorderBtns i={i} n={steps.length} onMove={(dir) => moveStep(i, dir)} label={d.name} />
                </td>
                <td data-label="Drop name">
                  <EditableText
                    value={d.name}
                    onCommit={(v) => renameStep(d, v)}
                    ariaLabel={`Drop ${d.name}`}
                  />
                </td>
                <td data-label="Minutes">
                  <div className="mins">
                    <EditableText
                      value={String(minutesOf(d))}
                      onCommit={(v) => retimeStep(d, v)}
                      ariaLabel={`Minutes for ${d.name}`}
                      className="mins-input"
                    />
                    min
                  </div>
                </td>
                <td className="no-label">
                  <button
                    className="admin-del"
                    onClick={() => deleteStep(d)}
                    aria-label={`Delete step ${d.name}`}
                    type="button"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="admin-add" onClick={addStep} type="button">
          + Add a step
        </button>
      </section>

      {/* ---------------- referral sources ---------------- */}
      <section className="admin-block" aria-labelledby="h-referral">
        <h2 id="h-referral">Referral sources</h2>
        <p className="hint">
          Options shown at Registration for &quot;how did they hear about us?&quot; — used for tracking where
          patients actually come from. &quot;Asks for a name&quot; shows an extra field (e.g. the referring
          doctor).
        </p>
        <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Source label</th>
              <th style={{ width: 150 }}>Asks for a name</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody id="referralList">
            {sources.map((r) => (
              <tr key={r.key}>
                <td data-label="Source">
                  <EditableText
                    value={r.label}
                    onCommit={(v) => renameSource(r, v)}
                    ariaLabel={`Source ${r.label}`}
                  />
                </td>
                <td data-label="Asks for a name">
                  <button
                    type="button"
                    className={`switch${needsDetail(r) ? ' on' : ''}`}
                    role="switch"
                    aria-checked={needsDetail(r)}
                    aria-label={`${r.label} asks for a name`}
                    onClick={() => toggleDetail(r)}
                  >
                    <div className="knob" />
                  </button>
                </td>
                <td className="no-label">
                  <button
                    className="admin-del"
                    onClick={() => deleteSource(r)}
                    aria-label={`Delete source ${r.label}`}
                    type="button"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="admin-add" onClick={addSource} type="button">
          + Add a source
        </button>
      </section>

      {/* ---------------- lens tiers ---------------- */}
      <section className="admin-block" aria-labelledby="h-lens">
        <h2 id="h-lens">Lens tiers &amp; prices</h2>
        <p className="hint">IOL options offered at OT billing, with the package price in rupees.</p>
        <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Lens</th>
              <th style={{ width: 140 }}>Price (₹)</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody id="lensList">
            {tiers.map((t) => (
              <tr key={refOf(t)}>
                <td data-label="Lens">
                  <EditableText
                    value={t.label}
                    onCommit={(v) => renameTier(t, v)}
                    ariaLabel={`Lens ${t.label}`}
                  />
                </td>
                <td data-label="Price">
                  <div className="mins">
                    ₹
                    <EditableText
                      value={String(t.price ?? 0)}
                      onCommit={(v) => repriceTier(t, v)}
                      ariaLabel={`Price for ${t.label}`}
                      className="price-input"
                    />
                  </div>
                </td>
                <td className="no-label">
                  <button
                    className="admin-del"
                    onClick={() => deleteTier(t)}
                    aria-label={`Delete lens ${t.label}`}
                    type="button"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="admin-add" onClick={addTier} type="button">
          + Add a lens tier
        </button>
      </section>

      {/* ---------------- OT slots & procedures (B12) ---------------- */}
      <OtSlotsSection run={run} />
      <OtProceduresSection run={run} />

      {/* ---------------- OT team: roles + outside doctors & partners ---------------- */}
      <OtTeamRolesSection run={run} />
      <OtPartnersSection run={run} />

      {/* ---------------- medicines (F12) — names only ---------------- */}
      <MedicinesSection
        medicines={medicines}
        run={run}
        showInactive={showInactiveMeds}
        onShowInactive={setShowInactiveMeds}
      />

      {/* ---------------- standard charges (lane B) ---------------- */}
      <ChargesSection run={run} />

      {/* ---------------- day-book columns (lane M) ---------------- */}
      <DayBookAdminSections run={run} />

      {/* ---------------- visit types & fee rules (lane E2) ---------------- */}
      <VisitFeesSection run={run} />

      {/* ---------------- diagnoses & treatment standards (B15/F17) ---------------- */}
      <TreatmentsSection run={run} />

      {/* ---------------- printed prescription: settings, exam findings, lens types (lane R) ---------------- */}
      <RxPrintAdminSections run={run} />

      {/* ---------------- import from KiviHealth (B13/F15) ---------------- */}
      <ImportSection />

      {/* ---------------- new patient form: link + QR poster (lane D) ---------------- */}
      <IntakeSection />

      {/* ---------------- family relations (lane E1) ---------------- */}
      <RelationsSection run={run} />

      {/* ---------------- staff ---------------- */}
      <section className="admin-block" aria-labelledby="h-staff">
        <h2 id="h-staff">Staff &amp; roles</h2>
        <p className="hint">
          Who can sign in and what they see. Admin sees everything; doctor gets prescriptions; reception and
          OT staff get their screens. Deactivated staff can&apos;t sign in but their history stays.
        </p>
        <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th style={{ width: 180 }}>Mobile</th>
              <th style={{ width: 150 }}>Role</th>
              <th style={{ width: 90 }}>Active</th>
              <th style={{ width: 130 }}></th>
            </tr>
          </thead>
          <tbody id="staffList">
            {staff.map((u) => (
              <tr key={u.id} className={u.active === false ? 'staff-inactive' : ''}>
                <td className="td-name">{u.name}</td>
                <td data-label="Username">{u.username}</td>
                <td data-label="Mobile">
                  <EditableText
                    value={u.phone || ''}
                    placeholder="10-digit mobile"
                    className="admin-phone"
                    onCommit={(v) => setPhone(u, v)}
                    ariaLabel={`Mobile for ${u.name}`}
                  />
                </td>
                <td data-label="Role">
                  <select
                    className="admin-select"
                    value={u.role}
                    aria-label={`Role for ${u.name}`}
                    onChange={(e) => setRole(u, e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Active">
                  <button
                    type="button"
                    className={`switch${u.active !== false ? ' on' : ''}`}
                    role="switch"
                    aria-checked={u.active !== false}
                    aria-label={`${u.name} active`}
                    onClick={() => toggleActive(u)}
                  >
                    <div className="knob" />
                  </button>
                </td>
                <td className="no-label">
                  <button type="button" className="admin-link" onClick={() => setPwFor(u)}>
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="admin-add" onClick={() => setStaffModal(true)} type="button">
          + Add a staff member
        </button>
      </section>

      <StaffModal
        open={staffModal}
        onClose={() => setStaffModal(false)}
        onCreate={async (body) => {
          const ok = await run(() => adminApi.staff.create(body), `${body.name} added`);
          if (ok) setStaffModal(false);
          return ok;
        }}
      />
      <PasswordModal
        user={pwFor}
        onClose={() => setPwFor(null)}
        onReset={async (password) => {
          const ok = await run(
            () => adminApi.staff.resetPassword(pwFor.id, password),
            `Password reset for ${pwFor.name}`
          );
          if (ok) setPwFor(null);
        }}
      />
    </div>
  );
}

/* ---- modals ---- */

function StaffModal({ open, onClose, onCreate }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', username: '', phone: '', password: '', role: 'reception' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ name: '', username: '', password: '', role: 'reception' });
  }, [open]);
  const submit = async () => {
    if (!f.name.trim() || !f.username.trim() || !f.password || !/^\d{10}$/.test(f.phone.replace(/\D/g, '').slice(-10))) {
      toast.error('Name, username and a password are needed.');
      return;
    }
    if (f.password.length < 4) {
      toast.error('Use a password of at least 4 characters.');
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        name: f.name.trim(),
        username: f.username.trim().toLowerCase(),
        phone: f.phone.trim(),
        password: f.password,
        role: f.role,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title="Add a staff member"
      sub="They sign in with this username and password. The mobile number identifies the person behind the login."
      onClose={onClose}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={submit} disabled={busy} type="button">
            {busy ? 'Adding…' : 'Add staff'}
          </button>
        </>
      }
    >
      <input
        className="fake-input"
        placeholder="Full name"
        aria-label="Full name"
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        autoFocus
      />
      <input
        className="fake-input"
        placeholder="Username"
        aria-label="Username"
        autoComplete="off"
        value={f.username}
        onChange={(e) => setF({ ...f, username: e.target.value })}
      />
      <input
        className="fake-input"
        placeholder="Mobile number (10 digits)"
        aria-label="Mobile number"
        inputMode="numeric"
        autoComplete="off"
        value={f.phone}
        onChange={(e) => setF({ ...f, phone: e.target.value })}
      />
      <input
        className="fake-input"
        placeholder="Password"
        aria-label="Password"
        type="password"
        autoComplete="new-password"
        value={f.password}
        onChange={(e) => setF({ ...f, password: e.target.value })}
      />
      <p className="label" style={{ marginBottom: 6 }}>
        Role
      </p>
      <select
        className="drop-select"
        aria-label="Role"
        value={f.role}
        onChange={(e) => setF({ ...f, role: e.target.value })}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </Modal>
  );
}

function PasswordModal({ user, onClose, onReset }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPw(''), [user]);
  const submit = async () => {
    if (pw.length < 4) {
      toast.error('Use a password of at least 4 characters.');
      return;
    }
    setBusy(true);
    try {
      await onReset(pw);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!user}
      title={user ? `Reset password — ${user.name}` : ''}
      sub="Tell them the new password in person; they can't recover it themselves."
      onClose={onClose}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={submit} disabled={busy} type="button">
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </>
      }
    >
      <input
        className="fake-input"
        placeholder="New password"
        aria-label="New password"
        type="password"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}


/* Jump list at the top of Admin: one chip per section, in page order. Clicking
   scrolls to that section; the address keeps #the-section so the link can be
   shared, and a fresh load with a hash lands there. */
const ADMIN_SECTIONS = [
  ['h-stages', 'Process stages'],
  ['h-protocol', 'Dilation drops'],
  ['h-referral', 'Referral sources'],
  ['h-lens', 'Lens prices'],
  ['h-otslots', 'OT slots'],
  ['h-otprocs', 'OT procedures'],
  ['h-otroles', 'OT team roles'],
  ['h-otpartners', 'Outside doctors'],
  ['h-medicines', 'Medicines'],
  ['h-charges', 'Standard charges'],
  ['h-heads', 'Day book columns'],
  ['h-visitfees', 'Visit types & fees'],
  ['h-treatments', 'Treatment standards'],
  ['h-rxprint', 'Prescription print'],
  ['h-exam', 'Exam findings'],
  ['h-lenstypes', 'Glass lens types'],
  ['h-import', 'Import from KiviHealth'],
  ['h-intake', 'New patient form'],
  ['h-relations', 'Family relations'],
  ['h-staff', 'Staff & roles'],
];

function AdminIndex() {
  const [active, setActive] = useState(null);
  const [top, setTop] = useState(0);
  // Sit just under the (sticky) top bar, whatever its height is on this screen.
  useEffect(() => {
    const bar = document.querySelector('.topbar');
    if (!bar) return undefined;
    const measure = () => setTop(bar.getBoundingClientRect().height);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const jump = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const section = el.closest('section') || el;
    const barH = document.querySelector('.admin-index')?.offsetHeight || 0;
    const y = section.getBoundingClientRect().top + window.scrollY - top - barH - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    setActive(id);
    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch {
      /* fine */
    }
  };
  useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (id && ADMIN_SECTIONS.some(([k]) => k === id)) {
      const t = setTimeout(() => jump(id), 300);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <nav className="admin-index" aria-label="Admin sections" style={{ top }}>
      {ADMIN_SECTIONS.map(([id, label]) => (
        <button
          type="button"
          key={id}
          className={`admin-index-chip${active === id ? ' active' : ''}`}
          onClick={() => jump(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
