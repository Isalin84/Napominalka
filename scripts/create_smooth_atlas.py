#!/usr/bin/env python3
"""Double every atlas row from 8 to 16 sharp display frames.

The hatch-pet 8x11 atlas remains the visual source of truth. Original keyframes
are copied into even columns verbatim; only odd columns are synthesized. Each
in-between keeps one sharp source pose and interpolates its alpha-mass center and
silhouette scale toward the next keyframe. No cross-fade or motion blur is used.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


CELL_WIDTH = 192
CELL_HEIGHT = 208
SOURCE_COLUMNS = 8
OUTPUT_COLUMNS = 16
ROWS = 11
SOURCE_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]


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


def sharp_midpoint(frame: Image.Image, next_frame: Image.Image) -> Image.Image:
    center_x, center_y, area = alpha_geometry(frame)
    next_x, next_y, next_area = alpha_geometry(next_frame)
    target_x = (center_x + next_x) / 2
    target_y = (center_y + next_y) / 2
    scale = float(np.clip(np.sqrt((area + next_area) / (2 * area)), 0.96, 1.04))
    inverse_scale = 1.0 / scale
    coefficients = (
        inverse_scale,
        0.0,
        center_x - target_x * inverse_scale,
        0.0,
        inverse_scale,
        center_y - target_y * inverse_scale,
    )
    return frame.transform(
        frame.size,
        Image.Transform.AFFINE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def process_atlas(source: Path, output: Path, preview_dir: Path | None) -> None:
    atlas = Image.open(source).convert("RGBA")
    expected_size = (SOURCE_COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT)
    if atlas.size != expected_size:
        raise ValueError(f"{source}: expected {expected_size}, got {atlas.size}")

    result = Image.new("RGBA", (OUTPUT_COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT))

    for row in range(ROWS):
        source_count = SOURCE_COUNTS[row]
        frames = [
            atlas.crop((column * CELL_WIDTH, row * CELL_HEIGHT, (column + 1) * CELL_WIDTH, (row + 1) * CELL_HEIGHT))
            for column in range(source_count)
        ]
        for source_column, frame in enumerate(frames):
            output_column = source_column * 2
            next_frame = frames[(source_column + 1) % source_count]
            result.alpha_composite(frame, (output_column * CELL_WIDTH, row * CELL_HEIGHT))
            result.alpha_composite(
                sharp_midpoint(frame, next_frame),
                ((output_column + 1) * CELL_WIDTH, row * CELL_HEIGHT),
            )

    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output, "WEBP", quality=94, method=6, exact=True)

    if preview_dir:
        preview_dir.mkdir(parents=True, exist_ok=True)
        for row, name in ((0, "idle"), (3, "waving"), (4, "jumping"), (6, "waiting")):
            frames = [
                result.crop((column * CELL_WIDTH, row * CELL_HEIGHT, (column + 1) * CELL_WIDTH, (row + 1) * CELL_HEIGHT))
                for column in range(OUTPUT_COLUMNS)
            ]
            frames[0].save(
                preview_dir / f"{name}-smooth.gif",
                save_all=True,
                append_images=frames[1:],
                duration=70 if name != "idle" else 95,
                loop=0,
                disposal=2,
                transparency=0,
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview-dir", type=Path)
    args = parser.parse_args()
    process_atlas(args.source, args.output, args.preview_dir)


if __name__ == "__main__":
    main()
