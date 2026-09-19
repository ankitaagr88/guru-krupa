import { useEffect, useRef, useState } from 'react';
import { readings as readingsApi, errorMessage, onDataChange } from '../../api';
import { useAuthedImage } from '../../lib/useAuthedImage';
import { fmtWhen } from './lib';
import './machines.css';

function PhotoTile({ photo, label, onRemove }) {
  const src = useAuthedImage(photo);
  return (
    <div className="photo-tile" data-testid="photo-tile">
      {src ? <img src={src} alt={label} /> : <div className="ph-empty">📎</div>}
      <div className="ph-cap">
        {label} · {fmtWhen(photo.capturedAt) || photo.capturedAt}
      </div>
      {onRemove && (
        <button type="button" className="rm" onClick={() => onRemove(photo)} aria-label={`Remove ${label}`}>
          ✕
        </button>
      )}
    </div>
  );
}

export { PhotoTile };

/* Exam photos for a visit (mockup `attachExamPhoto` / `renderExamPhotos` /
   `removeExamPhoto`): Adnexa, Ant. Seg., Lens, Fundus diagrams saved as photos. */
export default function ExamPhotos({ visitId, isMobile, isOffline }) {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      readingsApi
        .examPhotos(visitId)
        .then((r) => alive && setPhotos(r || []))
        .catch(() => {});
    load();
    const unsub = onDataChange(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [visitId]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const ph = await readingsApi.addExamPhoto(visitId, { file });
      setPhotos((list) => (list.some((x) => x.id === ph.id) ? list : [...list, ph]));
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not save the photo'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ph) => {
    try {
      await readingsApi.removeExamPhoto(visitId, ph.id);
      setPhotos((list) => list.filter((x) => x.id !== ph.id));
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not remove the photo'));
    }
  };

  return (
    <div data-testid="exam-photos">
      <p className="field-label">Exam photos</p>
      <p className="small-note">Adnexa, Ant. Seg., Lens, Fundus — the exam-sheet diagrams, saved as photos.</p>
      {photos.length === 0 ? (
        <p className="machine-list-empty" style={{ margin: '0 0 8px' }}>
          None attached yet
        </p>
      ) : (
        <div className="photo-grid">
          {photos.map((ph) => (
            <PhotoTile key={ph.id} photo={ph} label="Exam photo" onRemove={remove} />
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(isMobile ? { capture: 'environment' } : {})}
        onChange={onFile}
        style={{ display: 'none' }}
        data-testid="exam-photo-input"
      />
      <button
        type="button"
        className="capture-btn"
        onClick={() => inputRef.current?.click()}
        disabled={busy || isOffline}
        title={isOffline ? 'Exam photos need a connection' : ''}
      >
        {busy ? 'Saving photo…' : isMobile ? '📷 Attach exam photos' : '📎 Attach exam photo (file)'}
      </button>
      {err && <p className="reading-note err">{err}</p>}
    </div>
  );
}
