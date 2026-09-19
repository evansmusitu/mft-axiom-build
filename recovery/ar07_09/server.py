"""Same-origin local HTTP boundary for the AR-07 candidate application."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import secrets
import threading
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from recovery.ar03_06.common import (
    AuthenticationError,
    AuthorizationError,
    CandidateError,
    ConflictError,
    TenantIsolationError,
)

from .application import UnifiedApplication


STATIC_ROOT = Path(__file__).with_name("web")
MAX_BODY_BYTES = 64 * 1024
CSP = (
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
    "form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "connect-src 'self'; media-src 'none'"
)


class _BrowserSessions:
    def __init__(self):
        self._items = {}
        self._lock = threading.RLock()

    def create(self, runtime_token):
        browser_id = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        digest = hashlib.sha256(browser_id.encode()).hexdigest()
        with self._lock:
            self._items[digest] = {"runtime_token": runtime_token, "csrf": csrf}
        return browser_id, csrf

    def get(self, browser_id):
        digest = hashlib.sha256(str(browser_id or "").encode()).hexdigest()
        with self._lock:
            item = self._items.get(digest)
            return dict(item) if item else None

    def remove(self, browser_id):
        digest = hashlib.sha256(str(browser_id or "").encode()).hexdigest()
        with self._lock:
            self._items.pop(digest, None)


class CandidateApplicationServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, database, *, secret_key: bytes):
        self.application = UnifiedApplication(database, secret_key=secret_key)
        self.browser_sessions = _BrowserSessions()
        super().__init__(address, CandidateRequestHandler)

    def server_close(self):
        try:
            self.application.close()
        finally:
            super().server_close()


class CandidateRequestHandler(BaseHTTPRequestHandler):
    server_version = "AxiomCandidate/1"
    sys_version = ""

    def log_message(self, format, *args):
        return

    def _security_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")

    def _send_json(self, status, payload, *, cookie=None):
        body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, message):
        self._send_json(status, {"error": code, "message": str(message)[:300]})

    def _read_json(self):
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ValueError("Content-Type must be application/json")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length is invalid") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("request body exceeds the candidate limit")
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as exc:
            raise ValueError("request body must contain valid JSON") from exc
        if not isinstance(body, dict):
            raise ValueError("request body must be an object")
        return body

    def _browser_id(self):
        jar = SimpleCookie()
        jar.load(self.headers.get("Cookie", ""))
        morsel = jar.get("axiom_candidate_session")
        return morsel.value if morsel else ""

    def _session(self):
        session = self.server.browser_sessions.get(self._browser_id())
        if not session:
            raise AuthenticationError("browser session invalid or expired")
        return session

    def _expected_origin(self):
        host = self.headers.get("Host", "")
        return f"http://{host}"

    def _require_mutation_guard(self, session=None):
        origin = self.headers.get("Origin", "")
        if origin != self._expected_origin():
            raise AuthorizationError("same-origin mutation required")
        if session is not None:
            supplied = self.headers.get("X-Axiom-CSRF", "")
            if not secrets.compare_digest(supplied, session["csrf"]):
                raise AuthorizationError("CSRF token is missing or invalid")

    @staticmethod
    def _cookie(browser_id):
        return (
            f"axiom_candidate_session={browser_id}; Path=/; HttpOnly; "
            "SameSite=Strict; Max-Age=3600"
        )

    def _dispatch(self, method):
        parsed = urlsplit(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        app = self.server.application

        if method == "GET" and path == "/api/manifest":
            return self._send_json(HTTPStatus.OK, app.manifest())

        if method == "POST" and path == "/api/onboard":
            self._require_mutation_guard()
            body = self._read_json()
            owner = app.onboard(body.get("email"), body.get("password"), body.get("organization_name"))
            browser_id, csrf = self.server.browser_sessions.create(owner["session_token"])
            public = {key: value for key, value in owner.items() if key != "session_token"}
            public["csrf_token"] = csrf
            return self._send_json(HTTPStatus.CREATED, public, cookie=self._cookie(browser_id))

        if method == "POST" and path == "/api/login":
            self._require_mutation_guard()
            body = self._read_json()
            login = app.login(body.get("email"), body.get("password"))
            browser_id, csrf = self.server.browser_sessions.create(login["session_token"])
            public = {key: value for key, value in login.items() if key != "session_token"}
            public["csrf_token"] = csrf
            return self._send_json(HTTPStatus.OK, public, cookie=self._cookie(browser_id))

        session = self._session()
        token = session["runtime_token"]

        if method == "GET" and path == "/api/workspace":
            project_id = (query.get("project_id") or [""])[0]
            return self._send_json(HTTPStatus.OK, app.workspace(token, project_id))

        if method == "GET" and path.startswith("/api/tasks/"):
            task_id = path.removeprefix("/api/tasks/")
            project_id = (query.get("project_id") or [""])[0]
            return self._send_json(HTTPStatus.OK, app.task_detail(token, project_id, task_id))

        if method == "POST":
            self._require_mutation_guard(session)
            body = self._read_json()
            if path == "/api/tasks":
                result = app.compose(
                    token,
                    body.get("project_id"),
                    body.get("expression"),
                    request_id=body.get("request_id"),
                )
                return self._send_json(HTTPStatus.CREATED, result)
            if path == "/api/memory":
                result = app.save_memory(
                    token,
                    body.get("project_id"),
                    title=body.get("title"),
                    content=body.get("content"),
                )
                return self._send_json(HTTPStatus.CREATED, result)
            if path == "/api/logout":
                self.server.browser_sessions.remove(self._browser_id())
                return self._send_json(
                    HTTPStatus.OK,
                    {"logged_out": True},
                    cookie="axiom_candidate_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
                )
            if path.startswith("/api/tasks/"):
                parts = path.strip("/").split("/")
                if len(parts) == 4 and parts[0:2] == ["api", "tasks"]:
                    task_id, action = parts[2], parts[3]
                    if action == "cancel":
                        return self._send_json(HTTPStatus.OK, app.cancel(token, task_id))
                    if action == "retry":
                        return self._send_json(HTTPStatus.OK, app.retry(token, task_id))
                    if action == "redirect":
                        return self._send_json(
                            HTTPStatus.OK, app.redirect(token, task_id, body.get("operation"))
                        )
                    if action == "approve":
                        return self._send_json(
                            HTTPStatus.OK, app.approve(token, task_id, body.get("step_id"))
                        )
        return self._error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "route not found")

    def _serve_static(self):
        parsed = urlsplit(self.path)
        relative = "index.html" if parsed.path == "/" else parsed.path.lstrip("/")
        target = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT.resolve() not in target.parents and target != STATIC_ROOT.resolve():
            return self._error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "asset not found")
        if not target.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "asset not found")
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method):
        try:
            if self.path.startswith("/api/"):
                return self._dispatch(method)
            if method == "GET":
                return self._serve_static()
            return self._error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "route not found")
        except AuthenticationError as exc:
            return self._error(HTTPStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", exc)
        except (AuthorizationError, TenantIsolationError) as exc:
            return self._error(HTTPStatus.FORBIDDEN, "AUTHORIZATION_DENIED", exc)
        except ConflictError as exc:
            return self._error(HTTPStatus.CONFLICT, "CONFLICT", exc)
        except (ValueError, json.JSONDecodeError) as exc:
            return self._error(HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", exc)
        except CandidateError as exc:
            return self._error(HTTPStatus.UNPROCESSABLE_ENTITY, "CANDIDATE_ERROR", exc)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def serve(database, *, secret_key: bytes, host="127.0.0.1", port=8087):
    server = CandidateApplicationServer((host, int(port)), database, secret_key=secret_key)
    try:
        server.serve_forever()
    finally:
        server.server_close()
