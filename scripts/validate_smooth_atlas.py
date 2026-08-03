#!/usr/bin/env python3
"""Validate the 16-column display atlas against its hatch-pet master."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


CELL_WIDTH = 192
CELL_HEIGHT = 208
ROWS = 11
SOURCE_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("master", type=Path)
    parser.add_argument("smooth", type=Path)
    args = parser.parse_args()

    master = Image.open(args.master).convert("RGBA")
    smooth = Image.open(args.smooth).convert("RGBA")
    errors: list[str] = []
    if master.size != (1536, 2288):
        errors.append(f"master-size:{master.size}")
    if smooth.size != (3072, 2288):
        errors.append(f"smooth-size:{smooth.size}")

    empty_cells: list[str] = []
    weak_cells: list[str] = []
    alpha_mismatches: list[str] = []
    if not errors:
        for row in range(ROWS):
            output_count = SOURCE_COUNTS[row] * 2
            for column in range(16):
                box = (column * CELL_WIDTH, row * CELL_HEIGHT, (column + 1) * CELL_WIDTH, (row + 1) * CELL_HEIGHT)
                alpha = np.asarray(smooth.crop(box), dtype=np.uint8)[..., 3]
                if column < output_count and not np.any(alpha):
                    empty_cells.append(f"{row}:{column}")
                elif column < output_count and int(alpha.max()) < 250:
                    weak_cells.append(f"{row}:{column}:{int(alpha.max())}")
                elif column >= output_count and np.any(alpha):
                    errors.append(f"unexpected-used:{row}:{column}")
                if column < output_count and column % 2 == 0:
                    source_box = (
                        (column // 2) * CELL_WIDTH,
                        row * CELL_HEIGHT,
                        (column // 2 + 1) * CELL_WIDTH,
                        (row + 1) * CELL_HEIGHT,
                    )
                    source_alpha = np.asarray(master.crop(source_box), dtype=np.uint8)[..., 3]
                    if not np.array_equal(alpha, source_alpha):
                        alpha_mismatches.append(f"{row}:{column}")

    errors.extend(f"empty:{cell}" for cell in empty_cells)
    errors.extend(f"weak-alpha:{cell}" for cell in weak_cells)
    errors.extend(f"keyframe-alpha-mismatch:{cell}" for cell in alpha_mismatches)
    print(json.dumps({
        "ok": not errors,
        "master": str(args.master),
        "smooth": str(args.smooth),
        "size": list(smooth.size),
        "frames": 16 * ROWS,
        "errors": errors,
    }, ensure_ascii=False))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
