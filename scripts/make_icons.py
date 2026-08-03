#!/usr/bin/env python3
"""Собрать иконку приложения и значок для трея.

build/icon.png electron-builder сам превращает в .icns и .ico при сборке.
assets/icons/tray.png на macOS используется как шаблон: система перекрашивает
его под светлую и тёмную панель, поэтому там только чёрный цвет и прозрачность.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BOARD = ROOT / "assets" / "sources" / "pet-reference-board-cutout.png"
ICON_OUT = ROOT / "build" / "icon.png"
TRAY_OUT = ROOT / "assets" / "icons" / "tray.png"

CANVAS = 1024
# macOS ждёт поля вокруг рисунка, иначе иконка выглядит крупнее соседних.
INSET = 100
RADIUS = 185
BACKGROUND_TOP = (255, 248, 240)
BACKGROUND_BOTTOM = (243, 226, 210)


def crop_winnie() -> Image.Image:
    board = Image.open(BOARD).convert("RGBA")
    half = board.size[0] // 2
    quadrant = board.crop((0, 0, half, half))
    box = quadrant.getbbox()
    if not box:
        raise ValueError("в левом верхнем углу доски пусто")
    return quadrant.crop(box)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        ratio = y / max(size - 1, 1)
        gradient.putpixel((0, y), tuple(round(t + (b - t) * ratio) for t, b in zip(top, bottom)))
    return gradient.resize((size, size))


def build_app_icon() -> None:
    plate_size = CANVAS - INSET * 2
    plate = vertical_gradient(plate_size, BACKGROUND_TOP, BACKGROUND_BOTTOM).convert("RGBA")
    plate.putalpha(rounded_mask(plate_size, RADIUS))

    pet = crop_winnie()
    target_width = round(plate_size * 0.78)
    scale = target_width / pet.size[0]
    pet = pet.resize((target_width, round(pet.size[1] * scale)), Image.LANCZOS)

    x = (plate_size - pet.size[0]) // 2
    y = plate_size - pet.size[1] - round(plate_size * 0.06)
    plate.alpha_composite(pet, (x, max(y, 0)))

    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.alpha_composite(plate, (INSET, INSET))
    ICON_OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(ICON_OUT, "PNG")
    print(f"иконка приложения: {ICON_OUT.relative_to(ROOT)} {icon.size}")


def build_tray_icon() -> None:
    size = 44
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    black = (0, 0, 0, 255)

    # Отпечаток лапы: подушечка и четыре пальца.
    draw.ellipse((12, 21, 32, 38), fill=black)
    for cx, cy, rx, ry in ((10, 14, 4, 5), (17.5, 9, 4.5, 5.5), (26.5, 9, 4.5, 5.5), (34, 14, 4, 5)):
        draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=black)

    TRAY_OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(TRAY_OUT, "PNG")
    print(f"значок трея: {TRAY_OUT.relative_to(ROOT)} {image.size}")


if __name__ == "__main__":
    build_app_icon()
    build_tray_icon()
