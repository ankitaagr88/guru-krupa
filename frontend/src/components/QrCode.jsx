import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/* A QR code drawn as an SVG in the browser (no server, no network), with the standard 4-module
   quiet zone. Black on white whatever the theme, so phones can read it on screen and on paper.
   `level` M survives a little smudging on a printed poster. */
export default function QrCode({ text, size = 200, level = 'M', title, className = '' }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, level);
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { n: count + 8, path: d };
  }, [text, level]);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title || `QR code for ${text}`}
      data-testid="qr-code"
      data-text={text}
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
