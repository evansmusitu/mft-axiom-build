from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("AXIOM_PHASE13_ARTIFACT_DIR", "/tmp/axiom-interface-phase13"))
OUT.mkdir(parents=True, exist_ok=True)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main() -> None:
    handler = lambda *args, **kwargs: Quiet(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get("AXIOM_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or None)
            context = browser.new_context(viewport={"width": 1440, "height": 1500}, reduced_motion="reduce", accept_downloads=True)
            page = context.new_page()
            requests: list[str] = []
            page.on("request", lambda request: requests.append(request.url))
            page.goto(origin + "/index.html#/evidence", wait_until="networkidle")
            page.wait_for_function("()=>Boolean(window.AxiomEvidenceObservatoryBootstrap)")
            page.evaluate("()=>window.AxiomEvidenceObservatoryBootstrap")
            page.locator("#evidence-observatory-space").wait_for(state="visible")
            evaluations = page.evaluate("()=>window.AxiomEvidenceObservatory.store.listEvaluations()")
            assert len(evaluations) >= 3, evaluations
            by_id = {row["evaluation_id"]: row for row in evaluations}
            assert by_id["phase11-operator-earned"]["status"] == "PASS"
            assert by_id["phase12-provider-outage-attempts"]["status"] == "FAIL"
            assert by_id["phase12-provider-outage-attempts"]["failures"][0]["status"] == "PROVIDER_OUTAGE_UNQUALIFIED"
            assert by_id["phase15-frontier-comparison-not-run"]["status"] == "NOT_RUN"
            assert all(baseline["version"] == "NOT_CAPTURED" and baseline["external_origin_authenticated"] is False for baseline in by_id["phase15-frontier-comparison-not-run"]["baseline_versions"])
            integrity = page.evaluate("()=>window.AxiomEvidenceObservatory.store.verify()")
            assert integrity["status"] == "PASS", integrity
            local_claim = page.evaluate("()=>window.AxiomEvidenceObservatory.store.claimAuthorization('phase11-operator-earned','LOCAL_FUNCTIONAL_QUALIFICATION')")
            assert local_claim["authorized"] is True
            global_claim = page.evaluate("()=>window.AxiomEvidenceObservatory.store.claimAuthorization('phase11-operator-earned','GLOBAL_SUPERIORITY')")
            assert global_claim["authorized"] is False
            assert global_claim["independent_review_complete"] is False
            assert global_claim["global_superiority_claim_allowed"] is False
            self_attestation = page.evaluate("""()=>window.AxiomEvidenceObservatory.store.publishEvaluation({evaluationId:'self-attested-browser-fixture',definitionId:'independent-frontier-comparison',candidateVersion:'fixture',baselineVersions:[{provider:'Fixture',system:'Fixture',version:'NOT_CAPTURED',evidenceStatus:'NOT_RUN',resultsSha256:null,externalOriginAuthenticated:false}],sealedTestIdentities:[],evaluationDate:new Date().toISOString(),environment:{fixture:true},failures:[],scores:{},confidenceIntervals:{},externalAttestations:[{signed:true}],status:'NOT_RUN',evidenceArtifactDigests:[]}).then(()=> 'ALLOWED').catch(error=>error.name)""")
            assert self_attestation == "SecurityError", self_attestation
            duplicate = page.evaluate("""()=>window.AxiomEvidenceObservatory.store.publishEvaluation({evaluationId:'phase11-operator-earned',definitionId:'interface-phase-qualification',candidateVersion:'overwrite',baselineVersions:[{provider:'MUSITU',system:'Axiom',version:'old',evidenceStatus:'INHERITED',resultsSha256:null,externalOriginAuthenticated:false}],sealedTestIdentities:['a'.repeat(64)],evaluationDate:new Date().toISOString(),environment:{fixture:true},failures:[],scores:{runtime_gate:1},confidenceIntervals:{},externalAttestations:[],status:'PASS',evidenceArtifactDigests:['b'.repeat(64)]}).then(()=> 'ALLOWED').catch(error=>error.name)""")
            assert duplicate == "ConstraintError", duplicate
            review = page.evaluate("()=>window.AxiomEvidenceObservatory.store.independentReviewPacket(window.AxiomEvidenceObservatory.trustDocuments)")
            assert review["review_status"] == "AWAITING_AUTHENTICATED_INDEPENDENT_REVIEW"
            assert review["phase13_earned"] is False
            assert review["independent_review_complete"] is False
            assert len(review["trust_documents"]) == 5
            with page.expect_download() as download_info:
                page.locator("#evidence-export").click()
            download = download_info.value
            assert download.suggested_filename.startswith("axiom-evidence-review-")
            page.keyboard.press("Control+K")
            assert page.locator("#composer-input").evaluate("el=>el===document.activeElement")
            page.screenshot(path=str(OUT / "phase13-evidence-observatory-trust-center.png"), full_page=True)
            foreign = [url for url in requests if not url.startswith(origin + "/")]
            assert foreign == [], foreign
            evidence = {
                "schema": "musitu.axiom.interface.phase13-evidence-browser-evidence.v1",
                "status": "IMPLEMENTATION_PASS_AWAITING_INDEPENDENT_REVIEW",
                "public_read_ledger_preview_verified": True,
                "append_only_identity_reuse_rejected": True,
                "failed_evidence_visible": True,
                "not_run_external_baselines_visible": True,
                "external_versions_not_fabricated": True,
                "self_attestation_rejected": True,
                "claim_authorization_display_verified": True,
                "global_superiority_claim_blocked": True,
                "trust_documents_digest_bound": True,
                "downloadable_review_package_verified": True,
                "ctrl_k_inherited_focus_verified": True,
                "integrity_verified": True,
                "foreign_requests": foreign,
                "independent_review_complete": False,
                "phase13_earned": False,
                "public_deployment_claimed": False,
                "production_security_certified": False,
                "wcag_conformance_certified": False,
            }
            (OUT / "phase13-evidence-browser-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_INTERFACE_PHASE13_EVIDENCE_BROWSER_CANDIDATE_PASS")


if __name__ == "__main__":
    main()

