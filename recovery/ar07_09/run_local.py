"""Run the bounded AR-07 local candidate application."""

from __future__ import annotations

import argparse
import secrets

from .server import serve


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8087, type=int)
    args = parser.parse_args()
    serve(args.database, secret_key=secrets.token_bytes(32), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
