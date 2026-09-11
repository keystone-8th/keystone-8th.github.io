"""Compose every QR placard into one labelled PNG poster.

    python tools/placard-sheet.py

Reads qr-png/<ID>.png (made by tools/make-placards.js) and the labels in
scanpoints.js, writes qr-png/all-placards.png, and re-scans the result to
prove every code on it still decodes.
"""
import json, os, re, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

site = json.load(open("site.json", encoding="utf8"))["url"]
host = re.sub(r"^https?://", "", site)
sp = open("scanpoints.js", encoding="utf8").read()
points = re.findall(r'id: "([A-Z0-9]{2})".*?label: "([^"]+)"', sp, re.S)

cols, cell_w, cell_h, pad = 5, 360, 470, 30
rows = (len(points) + cols - 1) // cols
W, H = cols * cell_w + pad * 2, rows * cell_h + pad * 2 + 70
sheet = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(sheet)

def font(size, bold=False):
    for name in (["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"] if bold
                 else ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()

title_f, name_f, small_f = font(34, True), font(26, True), font(18)
d.text((pad, pad), "School placards  -  scan for directions", fill="black", font=title_f)
d.text((pad, pad + 42), "Each code opens " + site + " with that place as the start", fill="#555", font=small_f)

def centred(text, f, x0, y, colour):
    tw = d.textlength(text, font=f)
    d.text((x0 + (cell_w - tw) / 2, y), text, fill=colour, font=f)

for i, (pid, label) in enumerate(points):
    r, c = divmod(i, cols)
    x0, y0 = pad + c * cell_w, pad + 70 + r * cell_h
    d.rounded_rectangle([x0 + 8, y0 + 8, x0 + cell_w - 8, y0 + cell_h - 8], radius=16, outline="#333", width=3)
    qr = Image.open(f"qr-png/{pid}.png").convert("RGB").resize((300, 300), Image.NEAREST)
    sheet.paste(qr, (x0 + (cell_w - 300) // 2, y0 + 20))
    centred(label, name_f, x0, y0 + 330, "black")
    centred(f"{pid}  ·  {host}", small_f, x0, y0 + 372, "#0d7a4f")
    centred("Point your camera here", small_f, x0, y0 + 402, "#666")

out = "qr-png/all-placards.png"
sheet.save(out, optimize=True)
print(f"{out}: {sheet.size[0]}x{sheet.size[1]}, {len(points)} placards")

try:
    import cv2
    ok, infos, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(cv2.imread(out))
    found = sorted(i.rsplit("=", 1)[-1] for i in infos if i)
    missing = sorted(set(p for p, _ in points) - set(found))
    print("decoded on the sheet:", len(found), "missing:", missing or "none")
    if missing:
        sys.exit(1)
except ImportError:
    print("(install opencv-python to re-scan the sheet automatically)")
