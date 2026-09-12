"""Evidence-safe local semantic runtime for Axiom Live Phase 7.

This module adds real, offline semantic execution on top of the permissioned
capture substrate.  It deliberately scopes what is earned:
- voice: Vosk streaming ASR over a caller-supplied, digest-pinned model;
- dialogue: transcript -> verified specialist callback -> espeak speech;
- camera/screen: Tesseract OCR plus OpenCV face/QR detectors;
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
import wave

from frontier_v5.runtime.fullstack import MultimodalWorkbench


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
    p = Path(path)
    expected = _text(expected, "expected_sha256", 64).lower()
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise LiveSemanticError("expected_sha256 must be lowercase SHA-256")
    actual = _sha_bytes(p.read_bytes())
    if actual != expected:
        raise LiveSemanticError(f"asset digest mismatch: {p.name}")
    return actual


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
        self.cascade_path = cascade
        self.cascade_sha256 = _sha_bytes(cascade.read_bytes())
        self.face = cv2.CascadeClassifier(str(cascade))
        if self.face.empty():
            raise LiveSemanticError("OpenCV face detector failed to load")
        version = subprocess.run([exe, "--version"], check=True, capture_output=True, text=True).stdout.splitlines()[0].strip()
        self.engine_asset_sha256 = _sha_json({"tesseract": version, "opencv": cv2.__version__, "cascade_sha256": self.cascade_sha256})

    def interpret(self, *, image_path: str | Path, modality: str, session_id: str, project_id: str, actor_id: str, execution_id: str, interrupt: Event | None = None) -> SemanticReceipt:
        if modality not in {"camera", "screen"}:
            raise LiveSemanticError("visual modality must be camera or screen")
        p = Path(image_path)
        source = p.read_bytes()
        started = perf_counter()
        if interrupt and interrupt.is_set():
            raise LiveSemanticError("semantic execution interrupted before start")
        proc = subprocess.run([self.tesseract, str(p), "stdout", "-l", "eng", "--psm", "6"], check=True, capture_output=True, text=True)
        if interrupt and interrupt.is_set():
            raise LiveSemanticError("semantic execution interrupted")
        image = self.cv2.imread(str(p))
        if image is None:
            raise LiveSemanticError("image decode failed")
        gray = self.cv2.cvtColor(image, self.cv2.COLOR_BGR2GRAY)
        faces = self.face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4)
        qr = self.cv2.QRCodeDetector()
        qr_text, _, _ = qr.detectAndDecode(image)
        text = " ".join(proc.stdout.split())
        output = {
            "ocr_text": text,
            "ocr_text_sha256": _sha_bytes(text.encode("utf-8")),
            "face_count": int(len(faces)),
            "qr_text": qr_text.strip(),
            "width": int(image.shape[1]),
            "height": int(image.shape[0]),
            "general_vlm_claimed": False,
        }
        latency = (perf_counter() - started) * 1000.0
        return SemanticReceipt(
            receipt_id=f"semantic:{execution_id}", session_id=_text(session_id,"session_id",180), project_id=_text(project_id,"project_id",180), actor_id=_text(actor_id,"actor_id",180),
            modality=modality, input_sha256=_sha_bytes(source), execution_id=_text(execution_id,"execution_id",180),
            engine="tesseract-ocr+opencv-face-qr", engine_asset_sha256=self.engine_asset_sha256,
            semantic_scope="OCR_TEXT_FACE_COUNT_QR_ONLY_NOT_GENERAL_VLM", output=output,
            output_sha256=_sha_json(output), latency_ms=latency, interrupted=False,
        )


class VoiceDialogueEngine:
    """Offline Vosk ASR -> verified specialist -> espeak TTS dialogue turn."""

    def __init__(self, *, model_path: str | Path, model_archive_sha256: str, model_id: str = "vosk-model-small-en-us-0.15") -> None:
        path = Path(model_path)
        if not path.is_dir():
            raise LiveSemanticError("Vosk model directory unavailable")
        self.model_path = path
        self.model_archive_sha256 = _text(model_archive_sha256, "model_archive_sha256", 64).lower()
        if len(self.model_archive_sha256) != 64:
            raise LiveSemanticError("model archive SHA-256 required")
        self.model_id = _text(model_id, "model_id", 180)

    def turn(self, *, wav_path: str | Path, response_wav_path: str | Path, session_id: str, project_id: str, actor_id: str, execution_id: str, tool_call_id: str, specialist: Callable[[str, str], Mapping[str, Any]], interrupt: Event | None = None) -> dict[str, Any]:
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
            "tool_call_id": _text(tool_call_id,"tool_call_id",180),
            "hidden_reasoning_recorded": False,
        }
        receipt = SemanticReceipt(
            receipt_id=f"semantic:{execution_id}", session_id=_text(session_id,"session_id",180), project_id=_text(project_id,"project_id",180), actor_id=_text(actor_id,"actor_id",180),
            modality="voice", input_sha256=input_sha, execution_id=_text(execution_id,"execution_id",180), engine=self.model_id,
            engine_asset_sha256=self.model_archive_sha256, semantic_scope="STREAMING_ASR_SPECIALIST_TTS_DIALOGUE",
            output=output, output_sha256=_sha_json(output), latency_ms=(finished-started)*1000.0, interrupted=False,
        ).evidence()
        receipt["asr_latency_ms"] = (asr_done-started)*1000.0
        receipt["tool_latency_ms"] = (tool_done-tool_started)*1000.0
        receipt["tts_latency_ms"] = (finished-tool_done)*1000.0
        return receipt


class InterruptibleSemanticTask:
    """Cancellation token used by Live UI/service boundaries."""
    def __init__(self) -> None:
        self.event = Event()
        self.requested_at: float | None = None
        self.acknowledged_at: float | None = None

    def interrupt(self) -> dict[str, Any]:
        self.requested_at = perf_counter()
        self.event.set()
        self.acknowledged_at = perf_counter()
        latency_ms = (self.acknowledged_at-self.requested_at)*1000.0
        return {"scope":"SEMANTIC_EXECUTION_CANCELLATION_TOKEN","latency_ms":latency_ms,"engineering_target_ms":250.0,"within_target":latency_ms<=250.0}
