# SPDX-License-Identifier: GPL-3.0-or-later
import contextlib
import io
import unittest

import check_pr_title


class TitleTest(unittest.TestCase):
    def test_accepted_titles(self):
        for title in [
            "feat: add a dark theme",
            "fix(web): keep the brightness after a restart",
            "feat(protocol)!: change the reply of delete_all",
            "feat!: drop protocol 1",
            "ci: run CI once per change",
            "docs: describe the upload queue",
            "revert: undo the dark theme",
            "chore(deps): bump vite to 8.3.4",
            "fix: 2 typos in the README",
            "fix: x",
            # release-please's own pull requests, one per package
            "chore(main): release 0.1.0",
            "chore(main): release web 0.2.0",
            "chore(main): release 1.0.0-rc.1",
        ]:
            self.assertIsNone(check_pr_title.problem(title), title)

    def test_refused_titles_say_why(self):
        for title, reason in [
            ("Update README", 'start with a type and ": "'),
            ("update: the README", "type must be one of"),
            ("Feat: add a dark theme", "type must be one of"),
            ("feature: add a dark theme", "type must be one of"),
            ("feat(Web): add a dark theme", "scope must be"),
            ("feat(): add a dark theme", "scope must be"),
            ("feat: Add a dark theme", "start with a lowercase letter"),
            ("feat: Évite les doublons", "start with a lowercase letter"),
            ("feat:  add a dark theme", "start with a lowercase letter"),
            ("feat: add a dark theme.", "not end with a period"),
            ("feat: add a dark theme ", "not end with a period or a space"),
            ("feat: ", "must not be empty"),
            ("feat:add a dark theme", 'start with a type and ": "'),
            ('Revert "feat: add a dark theme"', "type must be one of"),
        ]:
            found = check_pr_title.problem(title)
            self.assertIsNotNone(found, title)
            self.assertIn(reason, found, title)

    def test_the_command_exits_0_or_1_and_says_why(self):
        def run(*argv):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = check_pr_title.main(["check_pr_title.py", *argv])
            return code, out.getvalue(), err.getvalue()

        self.assertEqual(run("fix: keep the brightness")[0], 0)
        code, _, err = run("Update README")
        self.assertEqual(code, 1)
        self.assertIn("not a conventional commit", err)
        self.assertEqual(run()[0], 2)


if __name__ == "__main__":
    unittest.main()
