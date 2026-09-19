import { useEffect, useState } from 'react';
import { client, USE_MOCKS } from '../api';

/* Uploaded images (`/api/uploads/{path}`) sit behind Bearer auth, so a plain
   <img src> can't load them. Fetch through the axios client as a blob and hand
   back an object URL. Mock mode already returns blob: URLs (or nothing). */
export function useAuthedImage(photo) {
  const direct = photo?.imageUrl ?? photo?.url ?? null;
  const path = photo?.imagePath ?? null;
  const isDirect = typeof direct === 'string' && /^(blob:|data:)/.test(direct);
  const [src, setSrc] = useState(isDirect ? direct : null);

  useEffect(() => {
    if (isDirect) {
      setSrc(direct);
      return undefined;
    }
    if (!path || USE_MOCKS) {
      setSrc(null);
      return undefined;
    }
    let alive = true;
    let objUrl = null;
    client
      .get(`/uploads/${path}`, { responseType: 'blob' })
      .then((res) => {
        if (!alive) return;
        objUrl = URL.createObjectURL(res.data);
        setSrc(objUrl);
      })
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [direct, isDirect, path]);

  return src;
}
