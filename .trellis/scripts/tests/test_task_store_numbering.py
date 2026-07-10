from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from common.task_store import _next_task_number_prefix  # noqa: E402


class TaskNumberPrefixTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.tasks_dir = Path(self.temp_dir.name)
        (self.tasks_dir / "archive").mkdir()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_empty_tasks_start_at_zero(self) -> None:
        self.assertEqual(_next_task_number_prefix(self.tasks_dir), "00")

    def test_active_task_allocates_next_number(self) -> None:
        (self.tasks_dir / "00-pr-create").mkdir()
        self.assertEqual(_next_task_number_prefix(self.tasks_dir), "01")

    def test_archived_highest_number_controls_allocation(self) -> None:
        (self.tasks_dir / "02-active").mkdir()
        month_dir = self.tasks_dir / "archive" / "2026-07"
        month_dir.mkdir()
        (month_dir / "09-archived").mkdir()
        self.assertEqual(_next_task_number_prefix(self.tasks_dir), "10")

    def test_gaps_and_legacy_names_do_not_reuse_numbers(self) -> None:
        (self.tasks_dir / "00-first").mkdir()
        (self.tasks_dir / "03-third").mkdir()
        (self.tasks_dir / "legacy-task").mkdir()
        self.assertEqual(_next_task_number_prefix(self.tasks_dir), "04")

    def test_numbers_grow_beyond_two_digits(self) -> None:
        (self.tasks_dir / "100-large").mkdir()
        self.assertEqual(_next_task_number_prefix(self.tasks_dir), "101")


if __name__ == "__main__":
    unittest.main()
