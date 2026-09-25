import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import {
  prescriptions,
  inventory as inventoryApi,
  readings,
  admin as adminApi,
  errorMessage,
} from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { treatments as treatmentsApi, doctor as doctorApi } from '../../api';
import MedicinePicker from '../../components/MedicinePicker';
import MedicineForm from '../Admin/MedicineForm';
import { HOSPITAL_NAME, DOCTOR_NAME } from '../../nav';
import { RX_LANGUAGES, visitInfo } from './hospital';
import PrescriptionPrint from './PrescriptionPrint';
import { hasUnsavedExamGlasses } from '../Queue/glasses';
import './prescription.css';

/* Prescription modal (mockup `openPrescriptionModal` + the drawer's medicine
   editor: buildMedDatalist / addMedManual / updateMedDosage / removeMed /
   renderMeds / photographPrescription / setLanguage).

   Props:
     visit    — { id, token?, patient?:{name,age,sex} } (real /visits/today row)
                or the mock's flat patient row { id, name, age, sex, token }.
     open     — optional; defaults to !!visit
     onClose  — called on Close / Esc / backdrop (asks first when there are unsaved changes)
     onSaved  — optional (prescriptionOut) after a successful save
     onVisitChange — optional (visitOut) after the diagnosis was changed here (it is saved on
                the visit straight away, like on the doctor's panel)
   The visit's `diagnosisId` preselects the diagnosis; its `followUpDate` prints as
   "Next visit" on the sheet.

   Each line = { name, medicineId, matched, dosage, qtyGiven, form?, formLabel? }:
     dosage   → the treatment plan printed for the patient
     qtyGiven → the doctor's "to give from clinic stock"; stock moves only when the front
                desk confirms the line at billing (DispensePanel)
   The picker searches GET /medicines by name; a line
   is `matched` when the name equals a medicine's name, brand or composition.
   Free-text lines get a "not in list" hint and, for admins, an inline
   "Add to medicine list" form (POST /admin/medicines) that re-matches the line.

   Diagnosis (B15/F17): picking one fills the lines with that diagnosis's
   treatment standard (Dr Anu's own, else the most common past prescription —
   counted, not AI). The doctor edits the differences; the diagnosis is saved
   with the prescription so it counts towards the history next time. */

const DOSAGE_PRESETS = [
  '1 drop, both eyes, 3x daily',
  '1 drop, both eyes, 2x daily',
  '1 drop, both eyes, at night',
  '1 tablet, after food, 2x daily',
];

function newLine(name, med) {
  return {
    name,
    medicineId: med?.id ?? null,
    matched: !!med,
    dosage: '',
    qtyGiven: 0,
    form: med?.form ?? null,
    formLabel: med?.formLabel ?? null,
  };
}

const lineFromApi = (l) => ({
  name: l.name,
  medicineId: l.medicineId ?? null,
  matched: l.matched ?? l.medicineId != null,
  dosage: l.dosage || '',
  qtyGiven: Number(l.qtyGiven) || 0,
  form: l.form ?? null,
  formLabel: l.formLabel ?? null,
});

const norm = (v) => (v || '').trim().toLowerCase();
const clockTime = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export default function PrescriptionModal({ visit, open, onClose, onSaved, onVisitChange }) {
  const isOpen = open ?? !!visit;
  const info = useMemo(() => visitInfo(visit), [visit]);
  const toast = useToast();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [lines, setLines] = useState([]);
  const [lang, setLang] = useState('english');
  const [meds, setMeds] = useState([]);
  const [stock, setStock] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null); // Date of the last save from this pop-up
  const [hasRx, setHasRx] = useState(false); // a prescription already exists for the visit
  const [printPayload, setPrintPayload] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photos, setPhotos] = useState(0);
  const [addingFor, setAddingFor] = useState(null); // index of the free-text line being added to the list
  const [addBusy, setAddBusy] = useState(false);
  const [medsKey, setMedsKey] = useState(0);
  const [diagnoses, setDiagnoses] = useState([]);
  const [diagnosisId, setDiagnosisId] = useState(null);
  const [fillNote, setFillNote] = useState(null); // {source, count, historyCount}
  const [fillBusy, setFillBusy] = useState(false);
  const fileRef = useRef(null);
  const printPending = useRef(false);
  const visitDiagnosisRef = useRef(null);
  visitDiagnosisRef.current = visit?.diagnosisId ?? null;

  const loadStock = useCallback(async () => {
    try {
      const rows = await inventoryApi.list();
      setStock(
        (rows || []).map((it) => ({
          ...it,
          reorder: it.reorderLevel ?? it.reorder ?? 0,
        }))
      );
    } catch {
      setStock([]);
    }
  }, []);

  // Load the existing prescription, the medicine list and stock when opened
  useEffect(() => {
    if (!isOpen || !info.id) return;
    let cancelled = false;
    setLoading(true);
    setDirty(false);
    setSavedAt(null);
    setPrintPayload(null);
    setPhotos(0);
    (async () => {
      const [rx, medList, dxList] = await Promise.all([
        prescriptions.get(info.id).catch(() => null),
        prescriptions.medicines({ q: '' }).catch(() => []),
        treatmentsApi.diagnoses().catch(() => []),
      ]);
      await loadStock();
      if (cancelled) return;
      const normMeds = (medList || []).map((m) => (typeof m === 'string' ? { id: null, name: m } : m));
      setMeds(normMeds);
      const existing = Array.isArray(rx) ? rx : rx?.lines || [];
      setLines(existing.map(lineFromApi));
      setHasRx(!!rx && existing.length > 0);
      setLang(rx?.printLanguage || 'english');
      setDiagnoses(Array.isArray(dxList) ? dxList : []);
      // The doctor's panel may have picked the diagnosis before any prescription was saved.
      setDiagnosisId(rx?.diagnosisId ?? visitDiagnosisRef.current ?? null);
      setFillNote(null);
      setAddingFor(null);
      setSearch('');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, info.id, loadStock]);

  // Typed text matches a master row by name, brand or composition (what the backend does on save)
  const findMed = (name) => {
    const t = norm(name);
    return meds.find((m) => norm(m.name) === t || norm(m.brand) === t || norm(m.composition) === t);
  };
  const stockFor = (line) =>
    stock.find((s) => (line.medicineId != null && s.medicineId === line.medicineId) || s.name === line.name);

  const pushLine = (name, med) => {
    if (lines.some((l) => norm(l.name) === norm(name))) {
      setSearch('');
      return;
    }
    setLines((ls) => [...ls, newLine(name, med)]);
    setSearch('');
    setDirty(true);
  };
  const addMedManual = () => {
    const val = search.trim();
    if (!val) return;
    const med = findMed(val);
    pushLine(med ? med.name : val, med);
  };
  const pickMed = (med) => pushLine(med.name, med);

  // Admin: add a free-text line to the master list, then re-match the line to it
  const addToList = async (i, body) => {
    setAddBusy(true);
    try {
      const med = await adminApi.medicines.create(body);
      setMeds((ms) => [...ms, med]);
      setMedsKey((k) => k + 1);
      setLines((ls) =>
        ls.map((l, j) =>
          j === i
            ? {
                ...l,
                name: med.name,
                medicineId: med.id,
                matched: true,
                form: med.form,
                formLabel: med.formLabel,
              }
            : l
        )
      );
      setDirty(true);
      setAddingFor(null);
      toast.success('Added to medicine list', med.displayName || med.name);
    } catch (err) {
      toast.error(
        err?.response?.status === 409 ? 'Already in the list' : 'Could not add medicine',
        errorMessage(err)
      );
    } finally {
      setAddBusy(false);
    }
  };

  const updateLine = (i, patch) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const removeMed = (i) => {
    setLines((ls) => ls.filter((_, j) => j !== i));
    setDirty(true);
  };

  const notifyLowStock = async (names) => {
    if (!names || names.length === 0) return;
    let rows = stock;
    try {
      rows = (await inventoryApi.list()).map((it) => ({
        ...it,
        reorder: it.reorderLevel ?? it.reorder ?? 0,
      }));
      setStock(rows);
    } catch {
      /* keep what we have */
    }
    names.forEach((n) => {
      const name = typeof n === 'string' ? n : n.name;
      const item = rows.find((r) => r.name === name) || (typeof n === 'object' ? n : null);
      if (item)
        toast.lowStock({
          name,
          stock: item.stock,
          unit: item.unit,
          reorder: item.reorder ?? item.reorderLevel,
        });
      else toast.lowStock({ name, stock: '?', unit: '', reorder: '?' });
    });
  };

  /* Diagnosis picked → fetch its standard and fill the lines. Existing lines are
     replaced only after the doctor confirms (the standard is a starting point). */
  const pickDiagnosis = async (value) => {
    const id = value ? Number(value) : null;
    setDiagnosisId(id);
    setDirty(true);
    setFillNote(null);
    // The diagnosis lives on the visit too (the doctor's panel shows it): save it there now.
    if (typeof doctorApi?.setDiagnosis === 'function')
      doctorApi
        .setDiagnosis(info.id, id)
        .then((v) => onVisitChange?.(v))
        .catch((err) => toast.error('Could not save the diagnosis on the visit', errorMessage(err)));
    if (!id) return;
    setFillBusy(true);
    try {
      const std = await treatmentsApi.standard(id);
      const stdLines = (std?.lines || []).map(lineFromApi);
      if (stdLines.length === 0) {
        setFillNote({ source: 'none', count: 0, historyCount: std?.historyCount || 0 });
        return;
      }
      if (lines.length > 0) {
        const ok = window.confirm(
          `Replace the ${lines.length} medicine${lines.length === 1 ? '' : 's'} already listed with the usual treatment for ${std.diagnosisName}?`
        );
        if (!ok) {
          setFillNote({ source: 'kept', count: stdLines.length, historyCount: std.historyCount || 0 });
          return;
        }
      }
      setLines(stdLines);
      setFillNote({ source: std.source, count: stdLines.length, historyCount: std.historyCount || 0 });
    } catch (err) {
      toast.error('Could not load the usual treatment', errorMessage(err));
    } finally {
      setFillBusy(false);
    }
  };

  const save = async () => {
    if (!info.id) return null;
    setSaving(true);
    try {
      const body = lines.map((l) => ({
        name: l.name,
        medicineId: l.medicineId ?? undefined,
        dosage: l.dosage,
        qtyGiven: Number(l.qtyGiven) || 0,
      }));
      const res = await prescriptions.save(info.id, body, lang, diagnosisId);
      setDirty(false);
      setSavedAt(new Date());
      setHasRx(true);
      if (Array.isArray(res?.lines)) setLines(res.lines.map(lineFromApi));
      toast.success(
        'Prescription saved',
        `${body.length} medicine${body.length === 1 ? '' : 's'} for ${info.name}`
      );
      await notifyLowStock(res?.lowStock);
      onSaved?.(res);
      return res;
    } catch (err) {
      const status = err?.response?.status;
      toast.error(status === 409 ? 'Not enough stock' : 'Could not save prescription', errorMessage(err));
      await loadStock();
      return null;
    } finally {
      setSaving(false);
    }
  };

  const print = async () => {
    if (
      hasUnsavedExamGlasses(info.id) &&
      !window.confirm(
        'Examination / glasses have unsaved changes and will print as last saved. Print anyway? (Cancel, then press "Save exam & glasses" first.)'
      )
    )
      return;
    if (dirty || lines.length === 0) {
      const ok = await save();
      if (!ok && dirty) return;
    }
    try {
      const payload = await prescriptions.printPayload(info.id, lang);
      printPending.current = true;
      setPrintPayload(payload);
    } catch (err) {
      toast.error('Could not prepare the print view', errorMessage(err));
    }
  };

  // window.print() after the print sheet has rendered
  useEffect(() => {
    if (!printPayload || !printPending.current) return;
    printPending.current = false;
    const t = setTimeout(() => {
      if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
    }, 50);
    return () => clearTimeout(t);
  }, [printPayload]);

  const photographPrescription = () => fileRef.current?.click();
  const onPhotoPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      await readings.addExamPhoto(info.id, { file, kind: 'prescription', label: 'Handwritten prescription' });
      setPhotos((n) => n + 1);
      toast.success('Prescription photo attached', 'Saved with the visit as an exam photo.');
    } catch (err) {
      toast.error('Photo upload failed', errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  };

  const given = lines.filter((l) => Number(l.qtyGiven) > 0).length;
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const close = () => {
    if (dirty && !window.confirm('This prescription has unsaved changes. Close without saving them?')) return;
    setPrintPayload(null);
    onClose?.();
  };

  // Save button: "Save" with changes, "Saving…", then "Saved at 10:42 am"; nothing to save → disabled.
  const saveLabel = saving
    ? 'Saving…'
    : dirty
      ? 'Save'
      : savedAt
        ? `Saved at ${clockTime(savedAt)}`
        : hasRx
          ? 'Saved'
          : 'Save';

  return (
    <>
      <Modal
        open={isOpen}
        onClose={close}
        className="rx-modal"
        id="prescriptionModalOverlay"
        actions={
          <>
            {dirty && !saving && (
              <span className="rx-unsaved" role="status" data-testid="rx-unsaved">
                Unsaved changes
              </span>
            )}
            <button className="btn-ghost" onClick={close} type="button">
              Close
            </button>
            <button
              className={`btn-primary full rx-save-btn${!dirty && !saving && (savedAt || hasRx) ? ' saved' : ''}`}
              onClick={save}
              disabled={saving || loading || !dirty}
              type="button"
            >
              {saveLabel}
            </button>
            <button
              className="btn-primary full rx-print-btn"
              onClick={print}
              disabled={saving || loading}
              type="button"
            >
              Print
            </button>
          </>
        }
      >
        <div className="rx-head">
          <img src="/logo.png" alt="Guru Krupa Eye Hospital & Laser Center" className="rx-head-logo" />
          <h3>{HOSPITAL_NAME}</h3>
          <p>{DOCTOR_NAME}, M.S. Ophthalmology</p>
        </div>
        <div className="rx-patient">
          <span>
            <b>{info.name}</b>
            {info.age ? `, ${info.age} yrs` : ''}
            {info.sex ? ` · ${info.sex}` : ''}
            {info.token ? ` · ${info.token}` : ''}
          </span>
          <span>{today}</span>
        </div>

        {loading ? (
          <div className="capture-flash">
            <div className="spin" />
            <p>Loading prescription…</p>
          </div>
        ) : (
          <>
            <div className="rx-diagnosis">
              <label className="field-label" htmlFor="rxDiagnosis">
                Diagnosis
              </label>
              <select
                id="rxDiagnosis"
                className="drop-select"
                value={diagnosisId ?? ''}
                onChange={(e) => pickDiagnosis(e.target.value)}
                disabled={fillBusy}
                aria-label="Diagnosis"
              >
                <option value="">— pick a diagnosis to fill the usual treatment —</option>
                {diagnoses.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {fillBusy && <p className="rx-fill-note">Looking up the usual treatment…</p>}
              {!fillBusy && fillNote && (
                <p className="rx-fill-note" data-testid="rx-fill-note">
                  {fillNote.source === 'admin' &&
                    `Filled ${fillNote.count} medicine${fillNote.count === 1 ? '' : 's'} from Dr Anu's standard treatment — change what this patient needs.`}
                  {fillNote.source === 'history' &&
                    `Filled ${fillNote.count} medicine${fillNote.count === 1 ? '' : 's'} from the most common prescription across ${fillNote.historyCount} past patient${fillNote.historyCount === 1 ? '' : 's'} — change what this patient needs.`}
                  {fillNote.source === 'none' &&
                    'No standard treatment yet for this diagnosis — add the medicines below; once saved, they start counting towards the usual treatment.'}
                  {fillNote.source === 'kept' && 'Kept the medicines already listed.'}
                </p>
              )}
            </div>
            <div className="rx-cols">
              <span>Medicine &amp; treatment plan</span>
              <span>Given from clinic</span>
            </div>
            <div className="med-rows" id="medChips">
              {lines.length === 0 && (
                <p className="rx-none">None added yet — search below or photograph the handwritten slip.</p>
              )}
              {lines.map((m, i) => {
                const s = stockFor(m);
                const qty = Number(m.qtyGiven) || 0;
                let avail = null;
                if (s) {
                  const cls =
                    s.stock <= 0
                      ? 'coral'
                      : qty > s.stock
                        ? 'coral'
                        : s.stock <= s.reorder
                          ? 'amber'
                          : 'sage';
                  const txt =
                    s.stock <= 0
                      ? 'out of stock'
                      : qty > s.stock
                        ? `only ${s.stock} ${s.unit} left`
                        : `${s.stock} ${s.unit} in stock${s.stock <= s.reorder ? ' · low' : ''}`;
                  avail = <span className={`rx-avail ${cls}`}>{txt}</span>;
                } else {
                  avail = <span className="rx-avail">not stocked · patient buys</span>;
                }
                return (
                  <div className={`med-row${m.matched ? '' : ' manual'}`} key={i} data-testid="med-row">
                    <div className="med-main">
                      <div className="med-name">
                        {m.name}
                        {m.matched ? (
                          <span className="match-tag">in list</span>
                        ) : (
                          <span className="match-tag rx-not-listed">not in list</span>
                        )}
                        {avail}
                        {!m.matched && isAdmin && addingFor !== i && (
                          <button
                            type="button"
                            className="rx-add-link"
                            onClick={() => setAddingFor(i)}
                            aria-label={`Add ${m.name} to medicine list`}
                          >
                            + Add to medicine list
                          </button>
                        )}
                      </div>
                      {!m.matched && isAdmin && addingFor === i && (
                        <div className="rx-add-med">
                          <p className="rx-add-med-title">Add to the medicine list</p>
                          <MedicineForm
                            initial={{ name: m.name }}
                            busy={addBusy}
                            idPrefix={`rxAddMed${i}`}
                            onCancel={() => setAddingFor(null)}
                            onSubmit={(body) => addToList(i, body)}
                          />
                        </div>
                      )}
                      <input
                        className="dosage-input"
                        placeholder="Dosage — e.g. 1 drop, both eyes, 3x daily"
                        list="rxDosagePresets"
                        aria-label={`Dosage for ${m.name}`}
                        value={m.dosage}
                        onChange={(e) => updateLine(i, { dosage: e.target.value })}
                      />
                    </div>
                    <div className="rx-qty">
                      <label>To give</label>
                      <div className="rx-qty-ctl">
                        <button
                          type="button"
                          onClick={() => updateLine(i, { qtyGiven: Math.max(0, qty - 1) })}
                          aria-label={`Less ${m.name}`}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          aria-label={`Quantity given of ${m.name}`}
                          value={qty}
                          onChange={(e) =>
                            updateLine(i, { qtyGiven: Math.max(0, parseInt(e.target.value, 10) || 0) })
                          }
                        />
                        <button
                          type="button"
                          onClick={() => updateLine(i, { qtyGiven: qty + 1 })}
                          aria-label={`More ${m.name}`}
                        >
                          +
                        </button>
                      </div>
                      <small>{s?.unit || 'units'}</small>
                    </div>
                    <button
                      className="rm"
                      onClick={() => removeMed(i)}
                      aria-label={`Remove ${m.name}`}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            {lines.length > 0 && (
              <p className="rx-split-note">
                {given} to be given from clinic stock · {lines.length - given} to buy outside. The front desk
                confirms what the patient actually buys at billing — only that comes off the stock.
              </p>
            )}

            <div className="med-manual">
              <MedicinePicker
                id="medSearchInput"
                value={search}
                onChange={setSearch}
                onPick={pickMed}
                onEnter={addMedManual}
                reloadKey={medsKey}
                placeholder="Search or type a medicine name…"
                ariaLabel="Medicine name"
              />
              <datalist id="rxDosagePresets">
                {DOSAGE_PRESETS.map((d) => (
                  <option value={d} key={d} />
                ))}
              </datalist>
              <button className="med-add-btn" onClick={addMedManual} type="button">
                Add
              </button>
            </div>

            <button
              className="rx-photo-btn"
              onClick={photographPrescription}
              disabled={photoBusy}
              type="button"
            >
              {photoBusy ? 'Uploading…' : 'Photograph handwritten prescription'}
              {photos > 0 && <span className="match-tag">{photos} attached</span>}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={onPhotoPicked}
              data-testid="rx-photo-input"
            />

            <div className="rx-lang">
              <span className="field-label">Print language</span>
              <div className="sex-toggle" id="rxLangToggle" role="group" aria-label="Print language">
                {RX_LANGUAGES.map((l) => (
                  <button
                    type="button"
                    key={l.key}
                    className={lang === l.key ? 'active' : ''}
                    aria-pressed={lang === l.key}
                    onClick={() => {
                      setLang(l.key);
                      setDirty(true);
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Modal>
      {isOpen && <PrescriptionPrint payload={printPayload} followUpDate={visit?.followUpDate} />}
    </>
  );
}
