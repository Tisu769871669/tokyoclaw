from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "xcdht_api.py"


def load_module():
    spec = importlib.util.spec_from_file_location("xcdht_api_under_test", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class XcdhtUserLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def run_cli(self, argv, fake_request):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            patch.object(self.module, "request_json", side_effect=fake_request),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            try:
                code = self.module.main(argv)
            except SystemExit as exc:
                code = exc.code if isinstance(exc.code, int) else 1
        return code, stdout.getvalue(), stderr.getvalue()

    def test_user_command_finds_member_by_order_user_id_from_filtered_response(self) -> None:
        calls = []

        def fake_request(endpoint, params, timeout, base_url):
            calls.append((endpoint, dict(params)))
            return {
                "data": {
                    "list": [
                        {
                            "id": 23788,
                            "mobile": "13800000000",
                            "shopTenantId": 9,
                        }
                    ]
                }
            }

        code, stdout, stderr = self.run_cli(
            ["--base-url", "https://api.test", "user", "--user-id", "23788"],
            fake_request,
        )

        self.assertEqual(0, code, stderr)
        payload = json.loads(stdout)
        self.assertEqual(23788, payload["id"])
        self.assertEqual("13800000000", payload["mobile"])
        self.assertEqual(("memberUserList", {"pageNo": 1, "pageSize": 100, "userId": 23788}), calls[0])

    def test_user_command_falls_back_to_paginated_member_list(self) -> None:
        calls = []

        def fake_request(endpoint, params, timeout, base_url):
            calls.append((endpoint, dict(params)))
            if "userId" in params:
                return {"data": {"list": []}}
            if params["pageNo"] == 1:
                return {"data": {"list": [{"id": 10001, "mobile": "13000000000"}]}}
            return {"data": {"list": [{"id": 23788, "phone": "13900000000"}]}}

        code, stdout, stderr = self.run_cli(
            [
                "--base-url",
                "https://api.test",
                "user",
                "--user-id",
                "23788",
                "--page-size",
                "1",
                "--max-pages",
                "3",
            ],
            fake_request,
        )

        self.assertEqual(0, code, stderr)
        payload = json.loads(stdout)
        self.assertEqual(23788, payload["id"])
        self.assertEqual("13900000000", payload["phone"])
        self.assertEqual(
            [
                ("memberUserList", {"pageNo": 1, "pageSize": 1, "userId": 23788}),
                ("memberUserList", {"pageNo": 1, "pageSize": 1}),
                ("memberUserList", {"pageNo": 2, "pageSize": 1}),
            ],
            calls,
        )

    def test_user_command_returns_error_when_user_id_is_not_found(self) -> None:
        def fake_request(endpoint, params, timeout, base_url):
            return {"data": {"list": []}}

        code, stdout, stderr = self.run_cli(
            [
                "--base-url",
                "https://api.test",
                "user",
                "--user-id",
                "23788",
                "--max-pages",
                "2",
            ],
            fake_request,
        )

        self.assertEqual(1, code)
        self.assertEqual("", stdout)
        self.assertIn("user not found: 23788", stderr)


if __name__ == "__main__":
    unittest.main()
