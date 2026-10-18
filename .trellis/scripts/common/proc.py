"""Child-process helpers shared across Trellis scripts."""

from __future__ import annotations

import subprocess
import sys


def hidden_kwargs() -> dict:
    """Extra ``subprocess`` kwargs that stop a child allocating a console window.

    The VS Code / OpenCode host is a GUI process with no console, so every
    console child (``git``, ``trellis``, ``cmd.exe``) would otherwise pop a
    window that flashes briefly. ``CREATE_NO_WINDOW`` is not inherited, so it
    must be set at every spawn level. No-op on POSIX.
    """
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}
