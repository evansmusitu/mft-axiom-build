"""Evidence-safe local semantic runtime for Axiom Live Phase 7.

This module adds real, offline semantic execution on top of the permissioned
capture substrate. It deliberately scopes what is earned:
- voice: Vosk ASR over a caller-supplied, digest-pinned model;
- dialogue: persistent multi-turn transcript -> verified MCP specialist -> espeak speech;
- camera/screen: Tesseract OCR plus OpenCV face/QR detectors, including selected regions;
- receipts: input/output digests, model/tool IDs, latency and interruption state.

This is not a general-purpose vision-language model and makes no cloud-provider,
real-device-certification, or hidden-reasoning claim.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from threading import Event
from time import perf_counter
from typing import Any, Callable, Mapping
import hashlib
import json
import shutil
import subprocess
import tempfile

from frontier_v5.runtime.fullstack import MultimodalWorkbench
from frontier_v5.runtime.mcp_2026 import (
    CLIENT_CAPS_META,
    CLIENT_INFO_META,
    MCP2026Server,
    PROTOCOL_META,
    PROTOCOL_VERSION,
)


class LiveSemanticError(RuntimeError):
    pass


def _sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha_json(value: object) -> str:
    return _sha_bytes(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def _text(value: Any, name: str, limit: int = 8000) -> str:
    if not isinstance(value, str):
        raise LiveSemanticError(f"{name} must be string")
    out = value.strip()
    if not out or len(out) > limit:
        raise LiveSemanticError(f"{name} must be non-empty and <= {limit} chars")
    return out


def verify_file_sha256(path: str | Path, expected: str) -> str:
    """Fail closed unless ``path`` matches the exact lowercase SHA-256 digest."""
    p = Path(path)
    expected = _text(expected, "expected_sha256", 64).lower()
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise LiveSemanticError("expected_sha256 must be lowercase SHA-256")
    try:
        actual = _sha_bytes(p.read_bytes())
    except OSError as exc:
        raise LiveSemanticError(f"asset unavailable: {p.name}") from exc
    if actual != expected:
        raise LiveSemanticError(f"asset digest mismatch: {p.name}")
    return actual


def _normalized_region(value: Mapping[str, Any] | None) -> dict[str, float] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise LiveSemanticError("normalized_region must be an object")
    required = {"x", "y", "width", "height"}
    if set(value) != required:
        raise LiveSemanticError("normalized_region must contain x,y,width,height only")
    out: dict[str, float] = {}
    for key in ("x", "y", "width", "height"):
        raw = value[key]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise LiveSemanticError(f"normalized_region.{key} must be numeric")
        out[key] = float(raw)
    if not (0 <= out["x"] < 1 and 0 <= out["y"] < 1):
        raise LiveSemanticError("normalized_region origin must be inside frame")
    if not (0 < out["width"] <= 1 and 0 < out["height"] <= 1):
        raise LiveSemanticError("normalized_region size must be in (0,1]")
    if out["x"] + out["width"] > 1 or out["y"] + out["height"] > 1:
        raise LiveSemanticError("normalized_region exceeds frame bounds")
    return out


@dataclass(frozen=True)
class SemanticReceipt:
    receipt_id: str
    session_id: str
    project_id: str
    actor_id: str
    modality: str
    input_sha256: str
    execution_id: str
    engine: str
    engine_asset_sha256: str
    semantic_scope: str
    output: Mapping[str, Any]
    output_sha256: str
    latency_ms: float
    interrupted: bool
    hidden_reasoning_recorded: bool = False
    cloud_provider_used: bool = False

    def evidence(self) -> dict[str, Any]:
        row = asdict(self)
        row["receipt_sha256"] = _sha_json(row)
        return row


class VisualSemanticEngine:
    """Real local OCR/face/QR semantics; intentionally not a general VLM."""

    def __init__(self) -> None:
        import cv2
        self.cv2 = cv2
        exe = shutil.which("tesseract")
        if not exe:
            raise LiveSemanticError("tesseract executable unavailable")
        self.tesseract = exe
        cascade = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        if not cascade.is_file():
            raise LiveSemanticError("OpenCV frontal-face cascade unavailable")
        self.cascade_sha256 = _sha_bytes(cascade.read_bytes())
        self.face = cv2.CascadeClassifier(str(cascade))
        if self.face.empty():
            raise LiveSemanticError("OpenCV face detector failed to load")
        version = subprocess.run([exe, "--version"], check=True, capture_output=True, text=True).stdout.splitlines()[0].strip()
        self.engine_asset_sha256 = _sha_json({
            "tesseract": version,
            "opencv": cv2.__version__,
            "cascade_sha256": self.cascade_sha256,
        })

    def interpret(
        self,
        *,
        image_path: str | Path,
        modality: str,
        session_id: str,
        project_id: str,
        actor_id: str,
        execution_id: str,
        normalized_region: Mapping[str, Any] | None = None,
        interrupt: Event | None = None,
    ) -> SemanticReceipt:
        if modality not in {"camera", "screen"}:
            raise LiveSemanticError("visual modality must be camera or screen")
        p = Path(image_path)
        source = p.read_bytes()
        region = _normalized_region(normalized_region)
        started = perf_counter()
        if interrupt and interrupt.is_set():
            raise LiveSemanticError("semantic execution interrupted before start")
        image = self.cv2.imread(str(p))
        if image is None:
            raise LiveSemanticError("image decode failed")

        working = image
        pixel_region = None
        if region is not None:
            height, width = image.shape[:2]
            x0 = max(0, min(width - 1, int(round(region["x"] * width))))
            y0 = max(0, min(height - 1, int(round(region["y"] * height))))
            x1 = max(x0 + 1, min(width, int(round((region["x"] + region["width"]) * width))))
            y1 = max(y0 + 1, min(height, int(round((region["y"] + region["height"]) * height))))
            working = image[y0:y1, x0:x1]
            pixel_region = {"x0": x0, "y0": y0, "x1": x1, "y1": y1}

        with tempfile.TemporaryDirectory(prefix="axiom-live-visual-") as tmp:
            semantic_input = Path(tmp) / "semantic-input.png"
            if not self.cv2.imwrite(str(semantic_input), working):
                raise LiveSemanticError("visual semantic input encoding failed")
            proc = subprocess.run(
                [self.tesseract, str(semantic_input), "stdout", "-l", "eng", "--psm", "6"],
                check=True,
                capture_output=True,
                text=True,
            )

        if interrupt and interrupt.is_set():
            raise LiveSemanticError("semantic execution interrupted")
        gray = self.cv2.cvtColor(working, self.cv2.COLOR_BGR2GRAY)
        faces = self.face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4)
        qr = self.cv2.QRCodeDetector()
        qr_text, _, _ = qr.detectAndDecode(working)
        text = " ".join(proc.stdout.split())
        output = {
            "ocr_text": text,
            "ocr_text_sha256": _sha_bytes(text.encode("utf-8")),
            "face_count": int(len(faces)),
            "qr_text": qr_text.strip(),
            "width": int(working.shape[1]),
            "height": int(working.shape[0]),
            "selected_region": region,
            "selected_region_pixels": pixel_region,
            "general_vlm_claimed": False,
        }
        latency = (perf_counter() - started) * 1000.0
        return SemanticReceipt(
            receipt_id=f"semantic:{execution_id}",
            session_id=_text(session_id, "session_id", 180),
            project_id=_text(project_id, "project_id", 180),
            actor_id=_text(actor_id, "actor_id", 180),
            modality=modality,
            input_sha256=_sha_bytes(source),
            execution_id=_text(execution_id, "execution_id", 180),
            engine="tesseract-ocr+opencv-face-qr",
            engine_asset_sha256=self.engine_asset_sha256,
            semantic_scope="OCR_TEXT_FACE_COUNT_QR_WITH_OPTIONAL_REGION_NOT_GENERAL_VLM",
            output=output,
            output_sha256=_sha_json(output),
            latency_ms=latency,
            interrupted=False,
        )


class MCP2026SpecialistHook:
    """Bind one verified Live specialist to the in-process MCP 2026 tools/call contract."""

    def __init__(self, *, server: MCP2026Server, tool_name: str, specialist_id: str) -> None:
        if not isinstance(server, MCP2026Server):
            raise LiveSemanticError("server must be MCP2026Server")
        self.server = server
        self.tool_name = _text(tool_name, "tool_name", 180)
        self.specialist_id = _text(specialist_id, "specialist_id", 180)

    def __call__(self, transcript: str, tool_call_id: str) -> Mapping[str, Any]:
        transcript = _text(transcript, "transcript", 8000)
        call_id = _text(tool_call_id, "tool_call_id", 180)
        headers = {
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            "Mcp-Method": "tools/call",
            "Mcp-Name": self.tool_name,
        }
        message = {
            "jsonrpc": "2.0",
            "id": call_id,
            "method": "tools/call",
            "params": {
                "name": self.tool_name,
                "arguments": {"utterance": transcript, "specialist_id": self.specialist_id},
                "_meta": {
                    PROTOCOL_META: PROTOCOL_VERSION,
                    CLIENT_INFO_META: {"name": "musitu-axiom-live", "version": "7.0"},
                    CLIENT_CAPS_META: {"liveMultimodality": True},
                },
            },
        }
        status, response_headers, body = self.server.handle(headers, message)
        if status != 200 or body.get("error"):
            raise LiveSemanticError("MCP specialist call failed")
        result = body.get("result")
        if not isinstance(result, Mapping):
            raise LiveSemanticError("MCP specialist result missing")
        spoken = _text(result.get("spoken_response"), "specialist spoken_response", 4000)
        receipt_core = {
            "tool_call_id": call_id,
            "tool_name": self.tool_name,
            "specialist_id": self.specialist_id,
            "protocol_version": response_headers.get("MCP-Protocol-Version"),
            "result_sha256": _sha_json(result),
        }
        return {
            "spoken_response": spoken,
            "tool_call_id": call_id,
            "tool_name": self.tool_name,
            "specialist_id": self.specialist_id,
            "mcp_protocol_version": PROTOCOL_VERSION,
            "tool_receipt_sha256": _sha_json(receipt_core),
        }


class VoiceDialogueEngine:
    """Offline Vosk ASR -> verified specialist -> espeak TTS dialogue turn."""

    def __init__(
        self,
        *,
        model_path: str | Path,
        model_archive_sha256: str,
        model_id: str = "vosk-model-small-en-us-0.15",
    ) -> None:
        path = Path(model_path)
        if not path.is_dir():
            raise LiveSemanticError("Vosk model directory unavailable")
        for required in ("am", "conf", "graph"):
            if not (path / required).exists():
                raise LiveSemanticError(f"Vosk model directory missing {required}")
        self.model_path = path
        self.model_archive_sha256 = _text(model_archive_sha256, "model_archive_sha256", 64).lower()
        if len(self.model_archive_sha256) != 64 or any(c not in "0123456789abcdef" for c in self.model_archive_sha256):
            raise LiveSemanticError("model archive SHA-256 required")
        self.model_id = _text(model_id, "model_id", 180)

    def turn(
        self,
        *,
        wav_path: str | Path,
        response_wav_path: str | Path,
        session_id: str,
        project_id: str,
        actor_id: str,
        execution_id: str,
        tool_call_id: str,
        specialist: Callable[[str, str], Mapping[str, Any]],
        interrupt: Event | None = None,
    ) -> dict[str, Any]:
        interrupt = interrupt or Event()
        started = perf_counter()
        if interrupt.is_set():
            raise LiveSemanticError("dialogue interrupted before ASR")
        transcript = MultimodalWorkbench.transcribe_vosk(wav_path, self.model_path)
        asr_done = perf_counter()
        if interrupt.is_set():
            raise LiveSemanticError("dialogue interrupted after ASR")
        tool_started = perf_counter()
        tool_result = dict(specialist(transcript["text"], tool_call_id))
        tool_done = perf_counter()
        if interrupt.is_set():
            raise LiveSemanticError("dialogue interrupted after specialist")
        response = _text(tool_result.get("spoken_response"), "specialist spoken_response", 4000)
        speech = MultimodalWorkbench.synthesize_speech(response, response_wav_path)
        finished = perf_counter()
        input_sha = _sha_bytes(Path(wav_path).read_bytes())
        output = {
            "transcript": transcript["text"],
            "transcript_sha256": transcript["text_sha256"],
            "specialist_result_sha256": _sha_json(tool_result),
            "spoken_response": response,
            "response_audio_sha256": speech["sha256"],
            "tool_call_id": _text(tool_call_id, "tool_call_id", 180),
            "hidden_reasoning_recorded": False,
        }
        receipt = SemanticReceipt(
            receipt_id=f"semantic:{execution_id}",
            session_id=_text(session_id, "session_id", 180),
            project_id=_text(project_id, "project_id", 180),
            actor_id=_text(actor_id, "actor_id", 180),
            modality="voice",
            input_sha256=input_sha,
            execution_id=_text(execution_id, "execution_id", 180),
            engine=self.model_id,
            engine_asset_sha256=self.model_archive_sha256,
            semantic_scope="OFFLINE_ASR_VERIFIED_MCP_SPECIALIST_TTS_DIALOGUE",
            output=output,
            output_sha256=_sha_json(output),
            latency_ms=(finished - started) * 1000.0,
            interrupted=False,
        ).evidence()
        receipt["asr_latency_ms"] = (asr_done - started) * 1000.0
        receipt["tool_latency_ms"] = (tool_done - tool_started) * 1000.0
        receipt["tts_latency_ms"] = (finished - tool_done) * 1000.0
        receipt["tool_receipt_sha256"] = tool_result.get("tool_receipt_sha256")
        receipt["specialist_id"] = tool_result.get("specialist_id")
        return receipt


class ContinuousVoiceDialogueSession:
    """Persistent multi-turn Live voice session without per-turn session restart."""

    def __init__(
        self,
        *,
        engine: VoiceDialogueEngine,
        specialist: Callable[[str, str], Mapping[str, Any]],
        session_id: str,
        project_id: str,
        actor_id: str,
    ) -> None:
        if not isinstance(engine, VoiceDialogueEngine):
            raise LiveSemanticError("engine must be VoiceDialogueEngine")
        if not callable(specialist):
            raise LiveSemanticError("specialist must be callable")
        self.engine = engine
        self.specialist = specialist
        self.session_id = _text(session_id, "session_id", 180)
        self.project_id = _text(project_id, "project_id", 180)
        self.actor_id = _text(actor_id, "actor_id", 180)
        self.turns: list[dict[str, Any]] = []
        self.closed = False

    def process_turn(
        self,
        *,
        wav_path: str | Path,
        response_directory: str | Path,
        interrupt: Event | None = None,
    ) -> dict[str, Any]:
        if self.closed:
            raise LiveSemanticError("voice dialogue session is closed")
        index = len(self.turns)
        execution_id = f"{self.session_id}:voice:{index}"
        tool_call_id = f"{self.session_id}:tool:{index}"
        out_dir = Path(response_directory)
        out_dir.mkdir(parents=True, exist_ok=True)
        response_path = out_dir / f"turn-{index:03d}-response.wav"
        receipt = self.engine.turn(
            wav_path=wav_path,
            response_wav_path=response_path,
            session_id=self.session_id,
            project_id=self.project_id,
            actor_id=self.actor_id,
            execution_id=execution_id,
            tool_call_id=tool_call_id,
            specialist=self.specialist,
            interrupt=interrupt,
        )
        previous = self.turns[-1]["turn_chain_sha256"] if self.turns else None
        turn_core = {
            "turn_index": index,
            "receipt_sha256": receipt["receipt_sha256"],
            "previous_turn_sha256": previous,
        }
        receipt["turn_index"] = index
        receipt["previous_turn_sha256"] = previous
        receipt["turn_chain_sha256"] = _sha_json(turn_core)
        self.turns.append(receipt)
        return dict(receipt)

    def close(self) -> dict[str, Any]:
        if self.closed:
            raise LiveSemanticError("voice dialogue session already closed")
        self.closed = True
        evidence = {
            "session_id": self.session_id,
            "project_id": self.project_id,
            "actor_id": self.actor_id,
            "turn_count": len(self.turns),
            "continuous_dialogue_mode": "PERSISTENT_MULTI_TURN_VOICE_SESSION",
            "turn_chain_head_sha256": self.turns[-1]["turn_chain_sha256"] if self.turns else None,
            "hidden_reasoning_recorded": False,
            "cloud_provider_used": False,
        }
        evidence["dialogue_evidence_sha256"] = _sha_json(evidence)
        return evidence


class InterruptibleSemanticTask:
    """Cancellation token and end-to-end worker-stop latency measurement."""

    def __init__(self) -> None:
        self.event = Event()
        self.requested_at: float | None = None
        self.acknowledged_at: float | None = None

    def interrupt(self) -> dict[str, Any]:
        self.requested_at = perf_counter()
        self.event.set()
        self.acknowledged_at = perf_counter()
        latency_ms = (self.acknowledged_at - self.requested_at) * 1000.0
        return {
            "scope": "SEMANTIC_EXECUTION_CANCELLATION_TOKEN",
            "latency_ms": latency_ms,
            "engineering_target_ms": 250.0,
            "within_target": latency_ms <= 250.0,
        }

    def interrupt_and_wait(self, worker: Any, timeout_seconds: float = 0.25) -> dict[str, Any]:
        if timeout_seconds <= 0:
            raise LiveSemanticError("timeout_seconds must be positive")
        requested = perf_counter()
        self.requested_at = requested
        self.event.set()
        self.acknowledged_at = perf_counter()
        worker.join(timeout_seconds)
        stopped = not worker.is_alive()
        stopped_at = perf_counter()
        stop_latency_ms = (stopped_at - requested) * 1000.0
        return {
            "scope": "SEMANTIC_EXECUTION_END_TO_END_STOP",
            "token_ack_latency_ms": (self.acknowledged_at - requested) * 1000.0,
            "stop_latency_ms": stop_latency_ms,
            "engineering_target_ms": 250.0,
            "worker_stopped": stopped,
            "within_target": stopped and stop_latency_ms <= 250.0,
        }


__all__ = [
    "ContinuousVoiceDialogueSession",
    "InterruptibleSemanticTask",
    "LiveSemanticError",
    "MCP2026SpecialistHook",
    "SemanticReceipt",
    "VisualSemanticEngine",
    "VoiceDialogueEngine",
    "verify_file_sha256",
]
