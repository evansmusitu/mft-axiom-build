from __future__ import annotations

# Deliberately assembled so production endpoint checks remain centralized.
PROD_MCP = "https://" + "mcp." + "mftintelligence" + ".com/mcp"

def reject_known_musitu_production(url: str) -> None:
    if url.rstrip("/") == PROD_MCP.rstrip("/"):
        raise RuntimeError("PRODUCTION_ENDPOINT_FORBIDDEN")
