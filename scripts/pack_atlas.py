#!/usr/bin/env python3
"""Собрать экранный атлас питомца из нарисованных ключевых кадров.

Мастер (assets/pets/runs/<питомец>/final/spritesheet-extended.png) - это сетка
8 на 11, где каждый кадр нарисован. Приложение показывает пять анимаций, поэтому
в атлас едут только их ряды: остальное было бы прозрачными пикселями в сборке.

Если рядом с питомцем есть ``illustrated-frames/<state>/00.png..07.png``, эти
восемь отдельно нарисованных 3D-поз становятся источником анимации. Между ними
достраивается только недостающее до экранного темпа число кадров. Все восемь
иллюстраций попадают в итоговый цикл без изменений.

Без ``--illustrated-root`` сохраняется прежний режим сборки из 8x11 мастера.

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
from itertools import combinations, permutations
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

# Экранный формат оставляем прежним, чтобы не менять renderer и CSS.
DISPLAY_COUNTS = {
    "idle": 18,
    "waving": 12,
    "jumping": 15,
    "waiting": 18,
    "review": 18,
}
ILLUSTRATED_KEYFRAMES = 8
# Темп должен совпадать с PET_ANIMATIONS в src/petRenderer.js.
CYCLE_MS = {
    "idle": 1200,
    "waving": 800,
    "jumping": 880,
    "waiting": 1080,
    "review": 1100,
}
# Позы нарисованы независимо друг от друга, поэтому фигура гуляет в размере
# от кадра к кадру (у Макса в покое 177-198 px при росте около 190). В цикле
# это читается как пульсация. Приводим всех к одному росту и ставим на общий пол.
STANDING_STATES = ("idle", "waiting", "review", "waving")

# Восемь поз на состояние нарисованы независимо, и не все складываются в цикл.
# У совы в ожидании кадры 1-3 это сильные развороты корпуса, а остальные
# фронтальные: подряд они читаются не как дыхание, а как размахивание крылом.
# Для спокойных состояний отбираем подмножество поз, которое идёт ровно,
# и раскладываем его по кругу. У взмаха и прыжка своя последовательность,
# их не трогаем.
#   состояние: (сколько поз оставить минимум, какой скачок считать допустимым)
CURATION = {
    "idle": (6, 18),
    "waiting": (4, 18),
    "review": (4, 18),
}
TARGET_FIGURE_HEIGHT = 193
FLOOR_Y = 203
SAFE_MARGIN = 3
# В прыжке питомец чуть меньше: иначе дуге некуда подниматься внутри ячейки.
JUMP_FIGURE_SCALE = 0.93
JUMP_LIFT = [0, 7, 16, 23, 26, 20, 10, 3]


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


def interpolate(first: Image.Image, second: Image.Image, weight: float, mode: str,
                allow_scale: bool = True) -> Image.Image:
    """Достроить кадр между двумя позами.

    ``allow_scale`` нужен для нарисованных поз: они уже приведены к общему росту,
    и подгонка масштаба по площади только вернула бы пульсацию. У широко
    расставленных крыльев площадь больше при том же росте, и старая формула
    честно, но вредно раздувала кадр.
    """
    first_x, first_y, first_area = alpha_geometry(first)
    second_x, second_y, second_area = alpha_geometry(second)
    target_x = first_x + (second_x - first_x) * weight
    target_y = first_y + (second_y - first_y) * weight
    ratio = np.sqrt(second_area / first_area) if allow_scale else 1.0

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


def foot_center_x(frame: Image.Image, bbox: tuple[int, int, int, int]) -> float:
    """Горизонтальный центр опоры.

    Центр рамки для выравнивания не годится: стоит питомцу отвести крыло или
    наклонить голову, и рамка уезжает вбок вместе с ним. Лапы же остаются на
    месте, поэтому считаем центр массы по нижней пятой части фигуры.
    """
    alpha = np.asarray(frame, dtype=np.float32)[..., 3]
    top = bbox[3] - max(1, round((bbox[3] - bbox[1]) * 0.22))
    band = alpha[top:bbox[3], bbox[0]:bbox[2]]
    mass = float(band.sum())
    if mass <= 0:
        return (bbox[0] + bbox[2]) / 2
    xs = np.arange(bbox[0], bbox[2], dtype=np.float32)
    return float((band.sum(axis=0) * xs).sum() / mass)


def place_figure(frame: Image.Image, figure_height: int, lift: int) -> Image.Image:
    """Привести фигуру к общему росту и поставить на общий пол."""
    bbox = frame.getbbox()
    if bbox is None:
        raise ValueError("пустой кадр")
    scale = figure_height / (bbox[3] - bbox[1])
    crop = frame.crop(bbox)
    width = max(1, round(crop.width * scale))
    height = max(1, round(crop.height * scale))
    resized = crop.resize((width, height), Image.Resampling.LANCZOS)

    anchor = (foot_center_x(frame, bbox) - bbox[0]) * scale
    left = round(CELL_WIDTH / 2 - anchor)
    left = max(SAFE_MARGIN, min(left, CELL_WIDTH - SAFE_MARGIN - width))
    top = max(SAFE_MARGIN, FLOOR_Y - lift - height)

    cell = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
    cell.alpha_composite(resized, (left, top))
    return cell


def curate_cycle(frames: list[Image.Image], min_count: int, max_step: float) -> tuple[list[int], float]:
    """Выбрать из нарисованных поз те, что складываются в ровный цикл.

    Перебираем подмножества от большего к меньшему и все порядки внутри них,
    оценивая самый резкий переход. Как только нашлось подмножество, где ни один
    переход не превышает порог, берём его: чем больше поз осталось, тем богаче
    движение. Если порог недостижим, возвращаем лучшее из найденного.
    """
    data = [np.asarray(frame, dtype=np.float32) for frame in frames]
    size = len(frames)
    distance = [[float(np.abs(data[i] - data[j]).mean()) for j in range(size)] for i in range(size)]

    fallback: tuple[float, float, list[int]] | None = None
    for count in range(size, min_count - 1, -1):
        best: tuple[float, float, list[int]] | None = None
        for subset in combinations(range(size), count):
            head, *rest = subset
            for tail in permutations(rest):
                order = [head, *tail]
                steps = [distance[order[i]][order[(i + 1) % count]] for i in range(count)]
                candidate = (max(steps), sum(steps), order)
                if best is None or candidate[:2] < best[:2]:
                    best = candidate
        if best is None:
            continue
        if fallback is None or best[:2] < fallback[:2]:
            fallback = best
        if best[0] <= max_step:
            return best[2], best[0]
    assert fallback is not None
    return fallback[2], fallback[0]


def load_pet_frames(frames_dir: Path) -> dict[str, list[Image.Image]]:
    """Прочитать все нарисованные позы питомца и привести их к общему масштабу."""
    raw: dict[str, list[Image.Image]] = {}
    for name, _, _ in KEPT_ROWS:
        state_dir = frames_dir / name
        frames: list[Image.Image] = []
        for index in range(ILLUSTRATED_KEYFRAMES):
            path = state_dir / f"{index:02d}.png"
            if not path.is_file():
                raise ValueError(f"нет нарисованного кадра {path}")
            frame = Image.open(path).convert("RGBA")
            if frame.size != (CELL_WIDTH, CELL_HEIGHT):
                raise ValueError(f"{path}: ожидался размер {(CELL_WIDTH, CELL_HEIGHT)}, получен {frame.size}")
            if not frame.getbbox():
                raise ValueError(f"пустой нарисованный кадр {path}")
            frames.append(frame)
        raw[name] = frames

    # Рост задан заранее, но у широких поз (расправленные крылья) после подгонки
    # может не хватить ширины ячейки. Тогда общий рост уменьшается для всех сразу.
    widest = 0.0
    for name in STANDING_STATES:
        for frame in raw[name]:
            bbox = frame.getbbox()
            widest = max(widest, (bbox[2] - bbox[0]) * TARGET_FIGURE_HEIGHT / (bbox[3] - bbox[1]))
    figure_height = TARGET_FIGURE_HEIGHT
    if widest > CELL_WIDTH - 2 * SAFE_MARGIN:
        figure_height = round(TARGET_FIGURE_HEIGHT * (CELL_WIDTH - 2 * SAFE_MARGIN) / widest)

    placed: dict[str, list[Image.Image]] = {}
    for name, _, _ in KEPT_ROWS:
        if name == "jumping":
            jump_height = round(figure_height * JUMP_FIGURE_SCALE)
            placed[name] = [place_figure(frame, jump_height, lift)
                            for frame, lift in zip(raw[name], JUMP_LIFT)]
        else:
            placed[name] = [place_figure(frame, figure_height, 0) for frame in raw[name]]

    for name, (min_count, max_step) in CURATION.items():
        order, worst = curate_cycle(placed[name], min_count, max_step)
        dropped = sorted(set(range(len(placed[name]))) - set(order))
        placed[name] = [placed[name][index] for index in order]
        note = f"выброшены {dropped}" if dropped else "все позы оставлены"
        print(f"      {name:8} {len(order)} поз, порядок {order}, худший переход {worst:.1f}, {note}")
    return placed


def resample_illustrated_cycle(keys: list[Image.Image], target_count: int, mode: str) -> list[Image.Image]:
    """Равномерно распределить все нарисованные позы по экранному циклу."""
    if target_count < len(keys):
        raise ValueError("экранный цикл не может быть короче числа нарисованных кадров")

    # Округление позиций распределяет интервалы длиной 1–3 кадра по всему циклу,
    # а не складывает погрешность в последнем переходе к первому кадру.
    anchors = [(index * target_count + len(keys) // 2) // len(keys) for index in range(len(keys))]
    frames: list[Image.Image | None] = [None] * target_count
    for index, key in enumerate(keys):
        start = anchors[index]
        end = anchors[(index + 1) % len(keys)]
        if index == len(keys) - 1:
            end += target_count
        steps = end - start
        frames[start % target_count] = key
        following = keys[(index + 1) % len(keys)]
        for step in range(1, steps):
            frames[(start + step) % target_count] = interpolate(
                key, following, step / steps, mode, allow_scale=False
            )

    if any(frame is None for frame in frames):
        raise ValueError("не удалось заполнить экранный цикл")
    return [frame for frame in frames if frame is not None]


def save_previews(rows: list[tuple[str, list[Image.Image]]], preview_dir: Path) -> None:
    preview_dir.mkdir(parents=True, exist_ok=True)
    for state, frames in rows:
        duration = round(CYCLE_MS[state] / len(frames))
        frames[0].save(
            preview_dir / f"{state}-smooth.gif",
            save_all=True,
            append_images=frames[1:],
            duration=duration,
            loop=0,
            disposal=2,
            transparency=0,
        )


def build(
    source: Path,
    output: Path,
    factor: int,
    mode: str,
    quality: int,
    illustrated_frames_dir: Path | None,
    preview_dir: Path | None,
) -> tuple[int, int, int]:
    atlas = Image.open(source).convert("RGBA")
    expected = (SOURCE_COLUMNS * CELL_WIDTH, SOURCE_ROWS * CELL_HEIGHT)
    if atlas.size != expected:
        raise ValueError(f"{source}: ожидался размер {expected}, получен {atlas.size}")

    if illustrated_frames_dir is None:
        named_rows = [
            (name, row_frames(atlas, row, count, factor, mode))
            for name, row, count in KEPT_ROWS
        ]
    else:
        pet_frames = load_pet_frames(illustrated_frames_dir)
        named_rows = [
            (name, resample_illustrated_cycle(pet_frames[name], DISPLAY_COUNTS[name], mode))
            for name, _, _ in KEPT_ROWS
        ]

    columns = max(len(frames) for _, frames in named_rows)
    packed = Image.new("RGBA", (columns * CELL_WIDTH, len(named_rows) * CELL_HEIGHT))
    for row_index, (_, frames) in enumerate(named_rows):
        for column, frame in enumerate(frames):
            packed.paste(frame, (column * CELL_WIDTH, row_index * CELL_HEIGHT))

    output.parent.mkdir(parents=True, exist_ok=True)
    packed.save(output, "WEBP", quality=quality, method=6, exact=True)
    if preview_dir is not None:
        save_previews(named_rows, preview_dir)
    return columns, len(named_rows), output.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", type=Path, help="мастера spritesheet-extended.png")
    parser.add_argument("--out", type=Path, required=True, help="куда класть <питомец>/spritesheet.webp")
    parser.add_argument("--factor", type=int, default=3, help="кадров на один ключевой (1 = без промежуточных)")
    parser.add_argument(
        "--mode",
        choices=["sharp", "morph"],
        help="по умолчанию sharp для нарисованных кадров, morph для старого мастера",
    )
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument(
        "--illustrated-root",
        type=Path,
        help="корень assets/pets с <питомец>/illustrated-frames",
    )
    parser.add_argument("--previews", action="store_true", help="обновить GIF-превью итоговых циклов")
    args = parser.parse_args()
    mode = args.mode or "morph"

    total = 0
    for source in args.sources:
        name = source.parent.parent.name
        output = args.out / name / "spritesheet.webp"
        illustrated_frames_dir = None
        if args.illustrated_root is not None:
            illustrated_frames_dir = args.illustrated_root / name / "illustrated-frames"
        preview_dir = args.out / name / "previews" if args.previews else None
        columns, rows, size = build(
            source,
            output,
            args.factor,
            mode,
            args.quality,
            illustrated_frames_dir,
            preview_dir,
        )
        total += size
        print(f"  {name:10} {columns:2} x {rows}  {size / 1024:6.0f} КБ")

    counts = (
        DISPLAY_COUNTS
        if args.illustrated_root is not None
        else {name: count * args.factor for name, _, count in KEPT_ROWS}
    )
    source_label = "8 нарисованных поз" if args.illustrated_root is not None else f"множитель {args.factor}"
    print(f"\nрежим {mode}, {source_label}, итого {total / 1024:.0f} КБ")
    print("кадров в анимации:", ", ".join(f"{k} {v}" for k, v in counts.items()))
    print("\nне забыть синхронно поправить:")
    print(f"  src/petRenderer.js  ATLAS_COLUMNS = {max(counts.values())}, ATLAS_ROWS = {len(KEPT_ROWS)}")
    print(f"  src/styles.css      background-size: {max(counts.values()) * 100}% {len(KEPT_ROWS) * 100}%")


if __name__ == "__main__":
    main()
