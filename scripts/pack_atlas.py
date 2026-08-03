#!/usr/bin/env python3
"""Оставить в атласе только те кадры, которые приложение действительно рисует.

Исходный сглаженный атлас - 16 колонок на 11 рядов (3072x2288). Интерфейс
показывает пять анимаций, и самая длинная из них занимает 12 кадров. Остальное
едет в сборке прозрачными пикселями: две трети файла.

Порядок рядов на выходе должен совпадать с PET_ANIMATIONS в src/petRenderer.js
и с background-size в src/styles.css.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
SOURCE_COLUMNS = 16
SOURCE_ROWS = 11

# (имя анимации, ряд в исходном атласе, сколько кадров реально используется)
KEPT_ROWS = [
    ("idle", 0, 12),
    ("waving", 3, 8),
    ("jumping", 4, 10),
    ("waiting", 6, 12),
    ("review", 8, 12),
]

OUTPUT_COLUMNS = max(frames for _, _, frames in KEPT_ROWS)
OUTPUT_ROWS = len(KEPT_ROWS)


def pack(source: Path, output: Path, quality: int) -> tuple[int, int]:
    atlas = Image.open(source).convert("RGBA")
    expected = (SOURCE_COLUMNS * CELL_WIDTH, SOURCE_ROWS * CELL_HEIGHT)
    if atlas.size != expected:
        raise ValueError(f"{source}: ожидался размер {expected}, получен {atlas.size}")

    packed = Image.new("RGBA", (OUTPUT_COLUMNS * CELL_WIDTH, OUTPUT_ROWS * CELL_HEIGHT))
    for target_row, (_, source_row, frames) in enumerate(KEPT_ROWS):
        for column in range(frames):
            box = (
                column * CELL_WIDTH,
                source_row * CELL_HEIGHT,
                (column + 1) * CELL_WIDTH,
                (source_row + 1) * CELL_HEIGHT,
            )
            cell = atlas.crop(box)
            if not cell.getbbox():
                raise ValueError(f"{source}: пустой кадр {source_row}:{column}")
            packed.paste(cell, (column * CELL_WIDTH, target_row * CELL_HEIGHT))

    before = source.stat().st_size
    packed.save(output, "WEBP", quality=quality, method=6, lossless=False, exact=True)
    return before, output.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", type=Path, help="исходные spritesheet.webp")
    parser.add_argument("--quality", type=int, default=90)
    parser.add_argument("--suffix", default="", help="писать рядом с исходником с этим суффиксом")
    args = parser.parse_args()

    print(f"сетка на выходе: {OUTPUT_COLUMNS} колонок x {OUTPUT_ROWS} рядов "
          f"({OUTPUT_COLUMNS * CELL_WIDTH}x{OUTPUT_ROWS * CELL_HEIGHT})")
    total_before = total_after = 0
    for source in args.sources:
        output = source.with_name(source.stem + args.suffix + source.suffix)
        before, after = pack(source, output, args.quality)
        total_before += before
        total_after += after
        print(f"{source.parent.name:10} {before / 1024:7.0f} КБ -> {after / 1024:7.0f} КБ")
    print(f"{'итого':10} {total_before / 1024:7.0f} КБ -> {total_after / 1024:7.0f} КБ "
          f"(-{100 - total_after * 100 / total_before:.0f}%)")


if __name__ == "__main__":
    main()
