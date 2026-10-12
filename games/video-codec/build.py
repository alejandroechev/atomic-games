#!/usr/bin/env python3
"""Inline src/ into a single standalone index.html.

The artifact has to open from a file:// URL in five years with no network and no
build step, so everything is inlined. The sources stay split for sanity.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src"
OUT = HERE / "index.html"

page = (SRC / "page.html").read_text(encoding="utf-8")
engine = (SRC / "engine.js").read_text(encoding="utf-8")
game = (SRC / "game.js").read_text(encoding="utf-8")

for js in (engine, game):
    if "</script" in js:
        sys.exit("refusing to inline: a source contains a closing script tag")

bundle = (
    '<script type="module">\n'
    "/* Bundled from src/engine.js and src/game.js by build.py — edit those, not this. */\n"
    + engine
    + "\n"
    + game
    + "\n</script>\n"
)

marker = "</main>\n</body>"
if marker not in page:
    sys.exit("page.html lost its </main></body> marker")

OUT.write_text(page.replace(marker, "</main>\n" + bundle + "</body>"), encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
