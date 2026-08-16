from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "client" / "public" / "favicon.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def circular_icon(source: Image.Image, size: int) -> Image.Image:
    fitted = source.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    fitted.putalpha(mask)
    return fitted


if not SOURCE.exists():
    raise SystemExit(f"Ativo de marca não encontrado: {SOURCE}")

with Image.open(SOURCE) as image:
    for density, size in SIZES.items():
        icon = circular_icon(image, size)
        target = RES / f"mipmap-{density}"
        target.mkdir(parents=True, exist_ok=True)
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            icon.save(target / name, format="PNG", optimize=True)

print("Ícones Android atualizados a partir de", SOURCE)
