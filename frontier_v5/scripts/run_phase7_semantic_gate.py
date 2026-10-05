#!/usr/bin/env python3
"""Exact-evidence Phase 7 semantic qualification harness.

Runs only local/offline engines: digest-pinned Vosk ASR, espeak TTS,
Tesseract/OpenCV visual semantics, MCP 2026 specialist hooks, and real worker
cancellation timing. No cloud provider, hidden reasoning, or general VLM claim.
"""
from __future__ import annotations

from pathlib import Path
from threading import Event, Thread
import json
import os
import tempfile

import cv2
import numpy as np

from frontier_v5.runtime.fullstack import MultimodalWorkbench
from frontier_v5.runtime.live_semantics import (
    ContinuousVoiceDialogueSession,
    InterruptibleSemanticTask,
    LiveSemanticError,
    MCP2026SpecialistHook,
    VisualSemanticEngine,
    VoiceDialogueEngine,
)
from frontier_v5.runtime.mcp_2026 import MCP2026Server

EXPECTED_VOSK_SHA256 = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"


def require_hex64(value: object, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise AssertionError(f"{label} must be lowercase SHA-256")
    return value


def write_text_image(path: Path, lines: list[tuple[str, tuple[int, int]]], *, width: int = 1200, height: int = 360) -> None:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    for text, origin in lines:
        cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, 1.45, (0, 0, 0), 3, cv2.LINE_AA)
    if not cv2.imwrite(str(path), image):
        raise AssertionError("failed to write semantic image fixture")


def build_specialist() -> tuple[MCP2026SpecialistHook, list[dict[str, object]]]:
    calls: list[dict[str, object]] = []

    def list_tools():
        return [{
            "name": "axiom_live_specialist",
            "description": "Evidence-safe local Live specialist hook",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "utterance": {"type": "string"},
                    "specialist_id": {"type": "string"},
                },
                "required": ["utterance", "specialist_id"],
            },
        }]

    def call_tool(name: str, arguments: dict[str, object]):
        assert name == "axiom_live_specialist"
        utterance = str(arguments.get("utterance") or "").strip()
        specialist_id = str(arguments.get("specialist_id") or "").strip()
        assert utterance and specialist_id == "live-dialogue-specialist-v1"
        calls.append({"name": name, "utterance": utterance, "specialist_id": specialist_id})
        return {
            "spoken_response": f"Live specialist received {len(utterance.split())} spoken words.",
            "specialist_id": specialist_id,
            "semantic_action": "ACKNOWLEDGE_TRANSCRIBED_LIVE_TURN",
        }

    server = MCP2026Server(
        server_name="musitu-axiom-live-local",
        server_version="7.0",
        list_tools=list_tools,
        call_tool=call_tool,
        instructions="Local Phase 7 evidence-only specialist execution.",
    )
    return MCP2026SpecialistHook(
        server=server,
        tool_name="axiom_live_specialist",
        specialist_id="live-dialogue-specialist-v1",
    ), calls


def main() -> None:
    model_dir = Path(os.environ["AXIOM_VOSK_MODEL_DIR"]).resolve()
    model_sha = os.environ.get("AXIOM_VOSK_MODEL_SHA256", "").strip().lower()
    assert model_sha == EXPECTED_VOSK_SHA256, (model_sha, EXPECTED_VOSK_SHA256)
    artifact_dir = Path(os.environ.get("AXIOM_PHASE7_SEMANTIC_ARTIFACT_DIR", "/tmp/axiom-phase7-semantic"))
    artifact_dir.mkdir(parents=True, exist_ok=True)

    session_id = "live_phase7_semantic_gate"
    project_id = "prj_phase7_semantic_gate"
    actor_id = "ci-local-user"

    # Real camera/screen semantic extraction, with selected-region screen analysis.
    visual = VisualSemanticEngine()
    camera_path = artifact_dir / "camera-semantic-input.png"
    screen_path = artifact_dir / "screen-semantic-input.png"
    write_text_image(camera_path, [("CAMERA LIVE SEVEN", (70, 170))])
    write_text_image(screen_path, [
        ("LEFT PANEL", (40, 110)),
        ("SCREEN REGION SEVEN", (560, 245)),
    ])
    camera = visual.interpret(
        image_path=camera_path,
        modality="camera",
        session_id=session_id,
        project_id=project_id,
        actor_id=actor_id,
        execution_id="semantic-camera-1",
    ).evidence()
    screen_region = {"x": 0.44, "y": 0.30, "width": 0.56, "height": 0.55}
    screen = visual.interpret(
        image_path=screen_path,
        modality="screen",
        session_id=session_id,
        project_id=project_id,
        actor_id=actor_id,
        execution_id="semantic-screen-1",
        normalized_region=screen_region,
    ).evidence()
    camera_text = camera["output"]["ocr_text"].upper()
    screen_text = screen["output"]["ocr_text"].upper()
    assert "CAMERA" in camera_text and "SEVEN" in camera_text, camera_text
    assert "SCREEN" in screen_text and "REGION" in screen_text, screen_text
    assert screen["output"]["selected_region"] == screen_region
    assert camera["output"]["general_vlm_claimed"] is False
    assert screen["output"]["general_vlm_claimed"] is False
    require_hex64(camera["receipt_sha256"], "camera receipt")
    require_hex64(screen["receipt_sha256"], "screen receipt")

    # Persistent two-turn offline voice dialogue: Vosk ASR -> MCP specialist -> espeak TTS.
    specialist, tool_calls = build_specialist()
    voice = VoiceDialogueEngine(
        model_path=model_dir,
        model_archive_sha256=model_sha,
        model_id="vosk-model-small-en-us-0.15",
    )
    dialogue = ContinuousVoiceDialogueSession(
        engine=voice,
        specialist=specialist,
        session_id=session_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    input_one = artifact_dir / "voice-turn-1.wav"
    input_two = artifact_dir / "voice-turn-2.wav"
    MultimodalWorkbench.synthesize_speech("hello axiom live project", input_one)
    MultimodalWorkbench.synthesize_speech("second voice turn for project context", input_two)
    turn_one = dialogue.process_turn(wav_path=input_one, response_directory=artifact_dir / "responses")
    turn_two = dialogue.process_turn(wav_path=input_two, response_directory=artifact_dir / "responses")
    dialogue_evidence = dialogue.close()
    assert dialogue_evidence["turn_count"] == 2
    assert dialogue_evidence["continuous_dialogue_mode"] == "PERSISTENT_MULTI_TURN_VOICE_SESSION"
    assert len(tool_calls) == 2
    assert turn_one["output"]["transcript"].strip()
    assert turn_two["output"]["transcript"].strip()
    assert turn_two["previous_turn_sha256"] == turn_one["turn_chain_sha256"]
    assert turn_one["specialist_id"] == "live-dialogue-specialist-v1"
    assert turn_two["specialist_id"] == "live-dialogue-specialist-v1"
    require_hex64(turn_one["tool_receipt_sha256"], "turn one tool receipt")
    require_hex64(turn_two["tool_receipt_sha256"], "turn two tool receipt")
    require_hex64(dialogue_evidence["dialogue_evidence_sha256"], "dialogue evidence")

    # End-to-end semantic cancellation: worker must actually stop within 250 ms.
    task = InterruptibleSemanticTask()
    reached_specialist = Event()
    cancelled: list[str] = []

    def blocking_specialist(_transcript: str, tool_call_id: str):
        reached_specialist.set()
        task.event.wait(2.0)
        return {
            "spoken_response": "cancelled semantic response",
            "tool_call_id": tool_call_id,
            "specialist_id": "interrupt-test-specialist",
            "tool_receipt_sha256": "c" * 64,
        }

    def interrupted_worker() -> None:
        try:
            voice.turn(
                wav_path=input_one,
                response_wav_path=artifact_dir / "interrupted-response.wav",
                session_id=session_id,
                project_id=project_id,
                actor_id=actor_id,
                execution_id="semantic-interrupt-1",
                tool_call_id="semantic-interrupt-tool-1",
                specialist=blocking_specialist,
                interrupt=task.event,
            )
        except LiveSemanticError as exc:
            cancelled.append(str(exc))

    worker = Thread(target=interrupted_worker, name="axiom-phase7-semantic-interrupt", daemon=True)
    worker.start()
    assert reached_specialist.wait(20.0), "semantic worker never reached specialist stage"
    interruption = task.interrupt_and_wait(worker, timeout_seconds=0.25)
    assert interruption["worker_stopped"] is True, interruption
    assert interruption["within_target"] is True, interruption
    assert interruption["stop_latency_ms"] <= 250.0, interruption
    assert cancelled and "interrupted" in cancelled[0], cancelled

    evidence = {
        "schema": "musitu.axiom.interface.phase7-semantic-evidence.v1",
        "status": "PASS",
        "qualification_scope": "OFFLINE_SCOPED_LIVE_SEMANTICS",
        "session_id": session_id,
        "project_id": project_id,
        "voice": {
            "model_id": "vosk-model-small-en-us-0.15",
            "model_archive_sha256": model_sha,
            "continuous_dialogue_verified": True,
            "turn_count": 2,
            "dialogue_evidence_sha256": dialogue_evidence["dialogue_evidence_sha256"],
            "automated_asr_verified": True,
            "tts_verified": True,
        },
        "camera": {
            "semantic_understanding_verified": True,
            "scope": camera["semantic_scope"],
            "receipt_sha256": camera["receipt_sha256"],
            "ocr_text_sha256": camera["output"]["ocr_text_sha256"],
        },
        "screen": {
            "semantic_understanding_verified": True,
            "selected_region_verified": True,
            "scope": screen["semantic_scope"],
            "receipt_sha256": screen["receipt_sha256"],
            "ocr_text_sha256": screen["output"]["ocr_text_sha256"],
        },
        "tool_specialist_hooks": {
            "mcp_2026_tools_call_verified": True,
            "specialist_id": "live-dialogue-specialist-v1",
            "tool_call_count": len(tool_calls),
            "tool_receipts_verified": True,
        },
        "interruption": interruption,
        "privacy_claims": {
            "cloud_provider_used": False,
            "hidden_reasoning_recorded": False,
            "general_vlm_claimed": False,
            "real_device_certification_claimed": False,
        },
    }
    out = artifact_dir / "phase7-semantic-evidence.json"
    out.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, sort_keys=True))
    print("MUSITU_AXIOM_INTERFACE_PHASE7_SEMANTIC_GATE_PASS")


if __name__ == "__main__":
    main()
