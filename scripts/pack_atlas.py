#!/usr/bin/env python3
"""Собрать атлас питомца из мастера с настоящими ключевыми кадрами.

Мастер (assets/pets/runs/<питомец>/final/spritesheet-extended.png) - это сетка
8 на 11, где каждый кадр нарисован. Приложение показывает пять анимаций, поэтому
в атлас едут только их ряды: остальное было бы прозрачными пикселями в сборке.

Между ключевыми кадрами достраиваются промежуточные, иначе движение выглядит
рывками: у покоя всего 6 нарисованных поз на 1,1 секунды, это меньше 6 кадров
в секунду.

Два способа достроить:

  sharp - взять предыдущий кадр и сдвинуть его к следующему. Поза не меняется,
          меняется только положение. Резко, но иногда читается как скольжение.
  morph - совместить оба кадра по центру массы и смешать с весом по времени.
          Движение получается мягче, на пушистых силуэтах шва не видно.

Порядок рядов на выходе должен совпадать с PET_ANIMATIONS в src/petRenderer.js
и с background-size в src/styles.css.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
SOURCE_COLUMNS = 8
SOURCE_ROWS = 11

# (имя анимации, ряд в мастере, сколько ключевых кадров нарисовано)
KEPT_ROWS = [
    ("idle", 0, 6),
    ("waving", 3, 4),
    ("jumping", 4, 5),
    ("waiting", 6, 6),
    ("review", 8, 6),
]


def alpha_geometry(frame: Image.Image) -> tuple[float, float, float]:
    alpha = np.asarray(frame, dtype=np.float32)[..., 3]
    mass = float(alpha.sum())
    if mass <= 0:
        return CELL_WIDTH / 2, CELL_HEIGHT / 2, 1.0
    y_grid, x_grid = np.indices(alpha.shape, dtype=np.float32)
    center_x = float((x_grid * alpha).sum() / mass)
    center_y = float((y_grid * alpha).sum() / mass)
    area = float(np.count_nonzero(alpha > 8))
    return center_x, center_y, max(area, 1.0)


def shift_scale(frame: Image.Image, target_x: float, target_y: float, scale: float) -> Image.Image:
    """Сдвинуть кадр так, чтобы его центр массы попал в цель, и слегка отмасштабировать."""
    center_x, center_y, _ = alpha_geometry(frame)
    inverse = 1.0 / scale
    coefficients = (
        inverse, 0.0, center_x - target_x * inverse,
        0.0, inverse, center_y - target_y * inverse,
    )
    return frame.transform(
        frame.size,
        Image.Transform.AFFINE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def blend(first: Image.Image, second: Image.Image, weight: float) -> Image.Image:
    """Смешать два кадра с учётом прозрачности: цвет берётся там, где есть альфа."""
    a = np.asarray(first, dtype=np.float32)
    b = np.asarray(second, dtype=np.float32)
    alpha_a = a[..., 3:4] * (1.0 - weight)
    alpha_b = b[..., 3:4] * weight
    total = alpha_a + alpha_b
    safe = np.maximum(total, 1e-6)
    rgb = (a[..., :3] * alpha_a + b[..., :3] * alpha_b) / safe
    out = np.concatenate([rgb, total], axis=-1)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def interpolate(first: Image.Image, second: Image.Image, weight: float, mode: str) -> Image.Image:
    first_x, first_y, first_area = alpha_geometry(first)
    second_x, second_y, second_area = alpha_geometry(second)
    target_x = first_x + (second_x - first_x) * weight
    target_y = first_y + (second_y - first_y) * weight
    ratio = np.sqrt(second_area / first_area)

    scale_first = float(np.clip(1.0 + (ratio - 1.0) * weight, 0.94, 1.06))
    warped_first = shift_scale(first, target_x, target_y, scale_first)
    if mode == "sharp":
        return warped_first

    scale_second = float(np.clip(1.0 + (1.0 / ratio - 1.0) * (1.0 - weight), 0.94, 1.06))
    warped_second = shift_scale(second, target_x, target_y, scale_second)
    return blend(warped_first, warped_second, weight)


def row_frames(atlas: Image.Image, row: int, count: int, factor: int, mode: str) -> list[Image.Image]:
    keys = [atlas.crop((c * CELL_WIDTH, row * CELL_HEIGHT, (c + 1) * CELL_WIDTH, (row + 1) * CELL_HEIGHT))
            for c in range(count)]
    for index, key in enumerate(keys):
        if not key.getbbox():
            raise ValueError(f"пустой ключевой кадр {row}:{index}")

    frames: list[Image.Image] = []
    for index, key in enumerate(keys):
        following = keys[(index + 1) % len(keys)]  # цикл замыкается на первый кадр
        frames.append(key)
        for step in range(1, factor):
            frames.append(interpolate(key, following, step / factor, mode))
    return frames


def build(source: Path, output: Path, factor: int, mode: str, quality: int) -> tuple[int, int, int]:
    atlas = Image.open(source).convert("RGBA")
    expected = (SOURCE_COLUMNS * CELL_WIDTH, SOURCE_ROWS * CELL_HEIGHT)
    if atlas.size != expected:
        raise ValueError(f"{source}: ожидался размер {expected}, получен {atlas.size}")

    rows = [row_frames(atlas, row, count, factor, mode) for _, row, count in KEPT_ROWS]
    columns = max(len(frames) for frames in rows)
    packed = Image.new("RGBA", (columns * CELL_WIDTH, len(rows) * CELL_HEIGHT))
    for row_index, frames in enumerate(rows):
        for column, frame in enumerate(frames):
            packed.paste(frame, (column * CELL_WIDTH, row_index * CELL_HEIGHT))

    output.parent.mkdir(parents=True, exist_ok=True)
    packed.save(output, "WEBP", quality=quality, method=6, exact=True)
    return columns, len(rows), output.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", type=Path, help="мастера spritesheet-extended.png")
    parser.add_argument("--out", type=Path, required=True, help="куда класть <питомец>/spritesheet.webp")
    parser.add_argument("--factor", type=int, default=3, help="кадров на один ключевой (1 = без промежуточных)")
    parser.add_argument("--mode", choices=["sharp", "morph"], default="morph")
    parser.add_argument("--quality", type=int, default=88)
    args = parser.parse_args()

    total = 0
    for source in args.sources:
        name = source.parent.parent.name
        output = args.out / name / "spritesheet.webp"
        columns, rows, size = build(source, output, args.factor, args.mode, args.quality)
        total += size
        print(f"  {name:10} {columns:2} x {rows}  {size / 1024:6.0f} КБ")

    counts = {name: count * args.factor for name, _, count in KEPT_ROWS}
    print(f"\nрежим {args.mode}, множитель {args.factor}, итого {total / 1024:.0f} КБ")
    print("кадров в анимации:", ", ".join(f"{k} {v}" for k, v in counts.items()))
    print("\nне забыть синхронно поправить:")
    print(f"  src/petRenderer.js  ATLAS_COLUMNS = {max(counts.values())}, ATLAS_ROWS = {len(KEPT_ROWS)}")
    print(f"  src/styles.css      background-size: {max(counts.values()) * 100}% {len(KEPT_ROWS) * 100}%")


if __name__ == "__main__":
    main()
