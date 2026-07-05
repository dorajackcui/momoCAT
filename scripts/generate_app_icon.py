#!/usr/bin/env python3
"""
Generate app icons for the desktop build pipeline.

Uses apps/desktop/build/icon-source.png as the full-bleed source image.
Outputs (under apps/desktop/build):
- icon.png (1024x1024)
- icon.icns (macOS)
- icon.ico (Windows, multi-size)
"""

from __future__ import annotations

import binascii
import math
import os
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "apps" / "desktop" / "build"
SOURCE_PNG = BUILD_DIR / "icon-source.png"
MASTER_PNG = BUILD_DIR / "icon.png"
ICONSET_DIR = BUILD_DIR / "icon.iconset"
ICNS_PATH = BUILD_DIR / "icon.icns"
ICO_PATH = BUILD_DIR / "icon.ico"

SIZE = 1024


def blend(dst: tuple[int, int, int, int], src: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    if sa >= 255:
        return src
    if sa <= 0:
        return dst
    inv = 255 - sa
    out_a = sa + (da * inv + 127) // 255
    if out_a == 0:
        return (0, 0, 0, 0)
    out_r = (sr * sa + dr * da * inv // 255) // out_a
    out_g = (sg * sa + dg * da * inv // 255) // out_a
    out_b = (sb * sa + db * da * inv // 255) // out_a
    return (out_r, out_g, out_b, out_a)


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = binascii.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    rows = []
    stride = width * 4
    for y in range(height):
        start = y * stride
        rows.append(b"\x00" + pixels[start : start + stride])
    raw = b"".join(rows)
    compressed = zlib.compress(raw, level=9)

    png = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def color_lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(a[0] + (b[0] - a[0]) * t),
        int(a[1] + (b[1] - a[1]) * t),
        int(a[2] + (b[2] - a[2]) * t),
    )


def put_px(buf: bytearray, x: int, y: int, c: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0 or x >= SIZE or y >= SIZE:
        return
    i = (y * SIZE + x) * 4
    dst = (buf[i], buf[i + 1], buf[i + 2], buf[i + 3])
    out = blend(dst, c)
    buf[i] = out[0]
    buf[i + 1] = out[1]
    buf[i + 2] = out[2]
    buf[i + 3] = out[3]


def fill_circle(buf: bytearray, cx: float, cy: float, r: float, color: tuple[int, int, int, int]) -> None:
    x0 = max(0, int(cx - r - 1))
    x1 = min(SIZE - 1, int(cx + r + 1))
    y0 = max(0, int(cy - r - 1))
    y1 = min(SIZE - 1, int(cy + r + 1))
    rr = r * r
    for y in range(y0, y1 + 1):
        dy = y - cy
        for x in range(x0, x1 + 1):
            dx = x - cx
            if dx * dx + dy * dy <= rr:
                put_px(buf, x, y, color)


def sign(p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float]) -> float:
    return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])


def point_in_triangle(pt: tuple[float, float], v1: tuple[float, float], v2: tuple[float, float], v3: tuple[float, float]) -> bool:
    d1 = sign(pt, v1, v2)
    d2 = sign(pt, v2, v3)
    d3 = sign(pt, v3, v1)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def fill_triangle(
    buf: bytearray,
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    color: tuple[int, int, int, int],
) -> None:
    x0 = max(0, int(min(a[0], b[0], c[0]) - 1))
    x1 = min(SIZE - 1, int(max(a[0], b[0], c[0]) + 1))
    y0 = max(0, int(min(a[1], b[1], c[1]) - 1))
    y1 = min(SIZE - 1, int(max(a[1], b[1], c[1]) + 1))
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if point_in_triangle((x + 0.5, y + 0.5), a, b, c):
                put_px(buf, x, y, color)


def dist_to_seg(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    vx = x2 - x1
    vy = y2 - y1
    wx = px - x1
    wy = py - y1
    c1 = vx * wx + vy * wy
    if c1 <= 0:
        return math.hypot(px - x1, py - y1)
    c2 = vx * vx + vy * vy
    if c2 <= c1:
        return math.hypot(px - x2, py - y2)
    t = c1 / c2
    ix = x1 + t * vx
    iy = y1 + t * vy
    return math.hypot(px - ix, py - iy)


def draw_line(
    buf: bytearray,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: float,
    color: tuple[int, int, int, int],
) -> None:
    pad = int(width // 2 + 2)
    x0 = max(0, int(min(x1, x2) - pad))
    x1b = min(SIZE - 1, int(max(x1, x2) + pad))
    y0 = max(0, int(min(y1, y2) - pad))
    y1b = min(SIZE - 1, int(max(y1, y2) + pad))
    r = width / 2
    for y in range(y0, y1b + 1):
        for x in range(x0, x1b + 1):
            if dist_to_seg(x + 0.5, y + 0.5, x1, y1, x2, y2) <= r:
                put_px(buf, x, y, color)


def draw_arc(
    buf: bytearray,
    cx: float,
    cy: float,
    r: float,
    start_deg: float,
    end_deg: float,
    width: float,
    color: tuple[int, int, int, int],
) -> None:
    steps = max(12, int((end_deg - start_deg) * r / 40))
    prev = None
    for i in range(steps + 1):
        t = i / steps
        deg = start_deg + (end_deg - start_deg) * t
        rad = math.radians(deg)
        x = cx + math.cos(rad) * r
        y = cy + math.sin(rad) * r
        if prev is not None:
            draw_line(buf, prev[0], prev[1], x, y, width, color)
        prev = (x, y)


def render_icon() -> bytearray:
    buf = bytearray(SIZE * SIZE * 4)
    top = (245, 158, 11)
    bottom = (234, 88, 12)
    glow = (255, 209, 128)

    # Background with vertical gradient and top glow.
    for y in range(SIZE):
        t = y / (SIZE - 1)
        base = color_lerp(top, bottom, t)
        for x in range(SIZE):
            dx = (x - SIZE * 0.5) / (SIZE * 0.55)
            dy = (y - SIZE * 0.35) / (SIZE * 0.45)
            d = min(1.0, math.sqrt(dx * dx + dy * dy))
            gl = 1.0 - d
            r = int(base[0] * (1 - 0.22 * gl) + glow[0] * 0.22 * gl)
            g = int(base[1] * (1 - 0.22 * gl) + glow[1] * 0.22 * gl)
            b = int(base[2] * (1 - 0.22 * gl) + glow[2] * 0.22 * gl)
            i = (y * SIZE + x) * 4
            buf[i] = max(0, min(255, r))
            buf[i + 1] = max(0, min(255, g))
            buf[i + 2] = max(0, min(255, b))
            buf[i + 3] = 255

    shadow = (122, 55, 5, 74)
    outline = (137, 60, 8, 255)
    fur = (255, 243, 214, 255)
    fur_shade = (244, 219, 174, 255)
    inner_ear = (255, 182, 175, 255)
    eye = (90, 48, 18, 255)
    nose = (232, 112, 109, 255)
    whisker = (137, 60, 8, 200)

    # Drop shadow behind head.
    fill_circle(buf, 512, 578, 306, shadow)

    # Ears (outline + fill).
    fill_triangle(buf, (300, 390), (416, 166), (532, 390), outline)
    fill_triangle(buf, (724, 390), (608, 166), (492, 390), outline)
    fill_triangle(buf, (324, 390), (418, 214), (512, 390), fur)
    fill_triangle(buf, (700, 390), (606, 214), (512, 390), fur)
    fill_triangle(buf, (364, 390), (422, 260), (480, 390), inner_ear)
    fill_triangle(buf, (660, 390), (602, 260), (544, 390), inner_ear)

    # Head + center face patch.
    fill_circle(buf, 512, 578, 286, outline)
    fill_circle(buf, 512, 578, 266, fur)
    fill_circle(buf, 512, 598, 180, fur_shade)

    # Eyes.
    fill_circle(buf, 420, 548, 34, eye)
    fill_circle(buf, 604, 548, 34, eye)
    fill_circle(buf, 430, 538, 10, (255, 255, 255, 210))
    fill_circle(buf, 614, 538, 10, (255, 255, 255, 210))

    # Nose + mouth.
    fill_triangle(buf, (512, 594), (468, 628), (556, 628), nose)
    draw_line(buf, 512, 628, 512, 655, 12, outline)
    draw_arc(buf, 486, 657, 34, 15, 165, 10, outline)
    draw_arc(buf, 538, 657, 34, 15, 165, 10, outline)

    # Whiskers.
    draw_line(buf, 312, 610, 452, 630, 12, whisker)
    draw_line(buf, 296, 650, 448, 650, 12, whisker)
    draw_line(buf, 312, 690, 452, 668, 12, whisker)
    draw_line(buf, 572, 630, 712, 610, 12, whisker)
    draw_line(buf, 576, 650, 728, 650, 12, whisker)
    draw_line(buf, 572, 668, 712, 690, 12, whisker)

    return buf


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ensure_tools() -> None:
    for tool in ("sips",):
        if not shutil_which(tool):
            raise RuntimeError(f"Missing required tool: {tool}")


def shutil_which(tool: str) -> str | None:
    for p in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(p) / tool
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def resize_png(master: Path, out: Path, size: int) -> None:
    run(["sips", "-s", "format", "png", "-z", str(size), str(size), str(master), "--out", str(out)])


def make_icns(master: Path) -> None:
    # ICNS entries encoded as PNG payloads.
    # type -> size
    icns_types = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
    ]

    elements: list[bytes] = []
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for type_code, size in icns_types:
            out = tmpdir / f"{size}.png"
            resize_png(master, out, size)
            data = out.read_bytes()
            elem_len = 8 + len(data)
            elements.append(type_code + struct.pack(">I", elem_len) + data)

    body = b"".join(elements)
    total_len = 8 + len(body)
    ICNS_PATH.write_bytes(b"icns" + struct.pack(">I", total_len) + body)


def make_ico(master: Path) -> None:
    sizes = [16, 32, 48, 64, 128, 256]
    png_bytes: list[bytes] = []

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for s in sizes:
            out = tmpdir / f"{s}.png"
            resize_png(master, out, s)
            png_bytes.append(out.read_bytes())

    count = len(sizes)
    header = struct.pack("<HHH", 0, 1, count)
    entries = bytearray()
    offset = 6 + (16 * count)
    for s, data in zip(sizes, png_bytes):
        w = 0 if s == 256 else s
        h = 0 if s == 256 else s
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    ICO_PATH.write_bytes(header + entries + b"".join(png_bytes))


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    if ICONSET_DIR.exists():
        shutil.rmtree(ICONSET_DIR)
    ensure_tools()
    if not SOURCE_PNG.is_file():
        raise FileNotFoundError(f"Missing icon source: {SOURCE_PNG}")
    resize_png(SOURCE_PNG, MASTER_PNG, SIZE)
    make_icns(MASTER_PNG)
    make_ico(MASTER_PNG)
    print(f"Generated: {MASTER_PNG}")
    print(f"Generated: {ICNS_PATH}")
    print(f"Generated: {ICO_PATH}")


if __name__ == "__main__":
    main()
