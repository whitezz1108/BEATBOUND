"""Editor UI wiring tests (prompt section 25, UI block).

The editor has no JS test harness; the Python suite is the framework
available, so these checks pin the contract the round depends on: the button
exists in the toolbar, the UI script actually downloads from the endpoint,
and the server route serves the file the analysis produced. The full
click-through is exercised manually against the real song (prompt 27.10).
"""

from __future__ import annotations

import os
import re

REPO = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
UI_DIR = os.path.join(REPO, "editor", "ui")
SERVER = os.path.join(REPO, "editor", "server", "server.mjs")


def _read(*parts: str) -> str:
    with open(os.path.join(REPO, *parts), encoding="utf-8") as fh:
        return fh.read()


def test_toolbar_has_download_director_context_button():
    html = _read("editor", "ui", "index.html")
    assert 'id="btn-download-director"' in html
    assert "Download Director Context" in html


def test_toolbar_has_download_full_analysis_button():
    html = _read("editor", "ui", "index.html")
    assert 'id="btn-download-full"' in html
    assert "Download Full Analysis" in html


def test_ui_script_downloads_from_the_endpoint():
    js = _read("editor", "ui", "editor.js")
    assert "/api/director-context" in js
    assert "btn-download-director" in js
    assert "director_context.json" in js, "the download must use the right filename"
    assert "/api/analysis-v2" in js


def test_server_serves_the_director_context_route():
    server = _read("editor", "server", "server.mjs")
    assert "/api/director-context" in server
    assert "analyze_music_v2.py" in server, "the analyze route must run the V2 pipeline"
    assert "director_context.json" in server


def test_server_download_sets_attachment_header():
    server = _read("editor", "server", "server.mjs")
    assert "Content-Disposition" in server
    assert re.search(r"attachment;\s*filename=.", server), (
        "the download route must force a download filename"
    )
    # The helper is what actually sets the header; the route must name the file.
    assert re.search(
        r"sendAnalysisFile\(res,\s*DIRECTOR_OUTPUT,\s*'director_context\.json'", server
    ), "the director-context route must pass the director_context.json filename"
