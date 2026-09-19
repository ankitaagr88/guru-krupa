"""QR code for the front desk: opens WhatsApp with the clinic number and the trigger pre-filled."""
from __future__ import annotations

import io
from html import escape
from urllib.parse import quote

import qrcode
from PIL import Image, ImageDraw, ImageFont

from app.config import ClinicConfig


def wa_link(clinic: ClinicConfig) -> str:
    return f"https://wa.me/{clinic.whatsapp_number}?text={quote(clinic.qr_trigger)}"


def qr_png(clinic: ClinicConfig, box_size: int = 12) -> bytes:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=box_size, border=3)
    qr.add_data(wa_link(clinic))
    qr.make(fit=True)
    code = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    try:
        font = ImageFont.load_default(size=max(18, code.width // 22))
    except TypeError:  # very old Pillow
        font = ImageFont.load_default()
    caption = clinic.name
    sub = "Scan · WhatsApp"
    draw = ImageDraw.Draw(code)
    cap_w = draw.textbbox((0, 0), caption, font=font)[2]
    sub_w = draw.textbbox((0, 0), sub, font=font)[2]
    line_h = int(font.size * 1.4)

    canvas = Image.new("RGB", (max(code.width, cap_w + 40), code.height + 2 * line_h + 16), "white")
    canvas.paste(code, ((canvas.width - code.width) // 2, 0))
    draw = ImageDraw.Draw(canvas)
    draw.text(((canvas.width - cap_w) // 2, code.height), caption, fill="black", font=font)
    draw.text(((canvas.width - sub_w) // 2, code.height + line_h), sub, fill="#555555", font=font)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


def qr_page_html(clinic: ClinicConfig) -> str:
    """Printable A5 page: big QR, clinic name, a one-line instruction in each language."""
    instructions = "".join(
        f'<p class="instr">{escape(clinic.qr_instructions.get(lang, ""))}</p>'
        for lang in clinic.languages
        if clinic.qr_instructions.get(lang)
    )
    local_names = " · ".join(escape(clinic.name_local.get(lang, "")) for lang in clinic.languages if clinic.name_local.get(lang))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{escape(clinic.name)} – WhatsApp registration QR</title>
<style>
  @page {{ size: A5 portrait; margin: 12mm; }}
  body {{ font-family: "Segoe UI", "Noto Sans", "Noto Sans Gujarati", "Noto Sans Devanagari", sans-serif;
         margin: 0; padding: 24px; text-align: center; color: #111; background: #fff; }}
  .sheet {{ max-width: 148mm; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  .local {{ font-size: 18px; color: #333; margin-bottom: 18px; }}
  img {{ width: 100mm; max-width: 100%; height: auto; }}
  .instr {{ font-size: 18px; margin: 10px 0; line-height: 1.5; }}
  .small {{ font-size: 12px; color: #666; margin-top: 18px; }}
  .print {{ margin-top: 20px; }}
  @media print {{ .print {{ display: none; }} }}
</style>
</head>
<body>
<div class="sheet">
  <h1>{escape(clinic.name)}</h1>
  <div class="local">{local_names}</div>
  <img src="/qr/{escape(clinic.id)}.png" alt="WhatsApp QR">
  {instructions}
  <p class="instr">New patients: scan this QR and send <b>{escape(clinic.qr_trigger)}</b> on WhatsApp.</p>
  <p class="small">{escape(wa_link(clinic))}</p>
  <button class="print" onclick="window.print()">Print (A5)</button>
</div>
</body>
</html>"""
