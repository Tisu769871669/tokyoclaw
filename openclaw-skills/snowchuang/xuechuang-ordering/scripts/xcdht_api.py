#!/usr/bin/env python3
"""Query Snowchuang Ordering MCP API with credentials from environment."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "https://mall.xuechuang.biz/app-api/mcp/api-mcp"
KEY_ENV = "XCDHT_MCP_KEY"
SECRET_ENV = "XCDHT_MCP_SECRET"
BASE_URL_ENV = "XCDHT_MCP_BASE_URL"


def positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{value!r} is not an integer") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be >= 1")
    return parsed


def read_credentials() -> tuple[str, str]:
    key = os.environ.get(KEY_ENV, "").strip()
    secret = os.environ.get(SECRET_ENV, "").strip()
    missing = [name for name, value in ((KEY_ENV, key), (SECRET_ENV, secret)) if not value]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(f"missing required environment variable(s): {joined}")
    return key, secret


def build_url(base_url: str, endpoint: str, params: dict[str, object]) -> str:
    root = base_url.rstrip("/")
    query = urllib.parse.urlencode(params)
    return f"{root}/{endpoint.lstrip('/')}?{query}"


def decode_body(data: bytes, content_type: str) -> object:
    charset = "utf-8"
    if "charset=" in content_type:
        charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip() or charset
    text = data.decode(charset, errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"_raw": text}


def request_json(endpoint: str, params: dict[str, object], timeout: float, base_url: str) -> object:
    key, secret = read_credentials()
    url = build_url(base_url, endpoint, params)
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "mcpKey": key,
            "mcpSecret": secret,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return decode_body(response.read(), response.headers.get("Content-Type", ""))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {endpoint}: {body[:1000]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"request failed for {endpoint}: {exc.reason}") from exc


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def add_page_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--page-no", type=positive_int, default=1, help="pageNo query parameter")
    parser.add_argument("--page-size", type=positive_int, default=20, help="pageSize query parameter")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Query Snowchuang Ordering MCP API.")
    parser.add_argument(
        "--base-url",
        default=os.environ.get(BASE_URL_ENV, DEFAULT_BASE_URL),
        help=f"API base URL; defaults to {BASE_URL_ENV} or the production endpoint",
    )
    parser.add_argument("--timeout", type=float, default=15.0, help="HTTP timeout in seconds")

    subparsers = parser.add_subparsers(dest="command", required=True)

    users = subparsers.add_parser("users", help="List member users")
    add_page_args(users)

    orders = subparsers.add_parser("orders", help="List orders for one member user")
    add_page_args(orders)
    orders.add_argument("--user-id", required=True, type=positive_int, help="userId query parameter")

    args = parser.parse_args(argv)

    try:
        if args.command == "users":
            payload = request_json(
                "memberUserList",
                {"pageNo": args.page_no, "pageSize": args.page_size},
                args.timeout,
                args.base_url,
            )
        elif args.command == "orders":
            payload = request_json(
                "memberUserOrderList",
                {"pageNo": args.page_no, "pageSize": args.page_size, "userId": args.user_id},
                args.timeout,
                args.base_url,
            )
        else:
            parser.error(f"unsupported command: {args.command}")
            return 2
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print_json(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
