import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { prescriptions, inventory as inventoryApi, readings, errorMessage } from '../../api';
import { HOSPITAL_NAME, DOCTOR_NAME } from '../../nav';
import { RX_LANGUAGES, visitInfo } from './hospital';
import PrescriptionPrint from './PrescriptionPrint';
import './prescription.css';

/* Prescription modal (mockup `openPrescriptionModal` + the drawer's medicine
   editor: buildMedDatalist / addMedManual / updateMedDosage / removeMed /
   renderMeds / photographPrescription / setLanguage).

   Props:
     visit    — { id, token?, patient?:{name,age,sex} } (real /visits/today row)
                or the mock's flat patient row { id, name, age, sex, token }.
     open     — optional; defaults to !!visit
     onClose  — called on Close / Esc / backdrop
     onSaved  — optional (prescriptionOut) after a successful save

   Each line = { name, medicineId, matched, dosage, qtyGiven }:
     dosage   → the treatment plan printed for the patient
     qtyGiven → what was handed over from clinic stock (decrements inventory) */

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
  };
}

export default function PrescriptionModal({ visit, open, onClose, onSaved }) {
  const isOpen = open ?? !!visit;
  const info = useMemo(() => visitInfo(visit), [visit]);
  const toast = useToast();

  const [lines, setLines] = useState([]);
  const [lang, setLang] = useState('english');
  const [meds, setMeds] = useState([]);
  const [stock, setStock] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [printPayload, setPrintPayload] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photos, setPhotos] = useState(0);
  const fileRef = useRef(null);
  const printPending = useRef(false);

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
    setPrintPayload(null);
    setPhotos(0);
    (async () => {
      const [rx, medList] = await Promise.all([
        prescriptions.get(info.id).catch(() => null),
        prescriptions.medicines({ q: '' }).catch(() => []),
      ]);
      await loadStock();
      if (cancelled) return;
      const normMeds = (medList || []).map((m) => (typeof m === 'string' ? { id: null, name: m } : m));
      setMeds(normMeds);
      const existing = Array.isArray(rx) ? rx : rx?.lines || [];
      setLines(
        existing.map((l) => ({
          name: l.name,
          medicineId: l.medicineId ?? null,
          matched: l.matched ?? l.medicineId != null,
          dosage: l.dosage || '',
          qtyGiven: Number(l.qtyGiven) || 0,
        }))
      );
      setLang(rx?.printLanguage || 'english');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, info.id, loadStock]);

  const findMed = (name) => meds.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());

  const stockFor = (line) =>
    stock.find((s) => (line.medicineId != null && s.medicineId === line.medicineId) || s.name === line.name);

  const addMedManual = () => {
    const val = search.trim();
    if (!val) return;
    if (lines.some((l) => l.name.toLowerCase() === val.toLowerCase())) {
      setSearch('');
      return;
    }
    const med = findMed(val);
    setLines((ls) => [...ls, newLine(med ? med.name : val, med)]);
    setSearch('');
    setDirty(true);
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
      const res = await prescriptions.save(info.id, body, lang);
      setDirty(false);
      if (Array.isArray(res?.lines)) {
        setLines(
          res.lines.map((l) => ({
            name: l.name,
            medicineId: l.medicineId ?? null,
            matched: l.matched ?? l.medicineId != null,
            dosage: l.dosage || '',
            qtyGiven: Number(l.qtyGiven) || 0,
          }))
        );
      }
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
    setPrintPayload(null);
    onClose?.();
  };

  return (
    <>
      <Modal
        open={isOpen}
        onClose={close}
        className="rx-modal"
        id="prescriptionModalOverlay"
        actions={
          <>
            <button className="btn-ghost" onClick={close} type="button">
              Close
            </button>
            <button className="btn-primary full" onClick={save} disabled={saving || loading} type="button">
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            <button
              className="btn-primary full rx-print-btn"
              onClick={print}
              disabled={saving || loading}
              type="button"
            >
              🖨 Print
            </button>
          </>
        }
      >
        <div className="rx-head">
          <img src="/logo.jpg" alt="" className="rx-head-logo" />
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
                          <span className="match-tag">free text</span>
                        )}
                        {avail}
                      </div>
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
                      <label>Qty given</label>
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
                {given} given from clinic stock · {lines.length - given} prescribed only (patient buys
                outside)
              </p>
            )}

            <div className="med-manual">
              <input
                list="medMasterList"
                className="med-search"
                id="medSearchInput"
                placeholder="Search medicine name, or type a new one…"
                aria-label="Medicine name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addMedManual();
                  }
                }}
              />
              <datalist id="medMasterList">
                {meds.map((m) => (
                  <option value={m.name} key={m.id ?? m.name} />
                ))}
              </datalist>
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
              {photoBusy ? 'Uploading…' : '📷 Photograph handwritten prescription'}
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
      {isOpen && <PrescriptionPrint payload={printPayload} />}
    </>
  );
}
