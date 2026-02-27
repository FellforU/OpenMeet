"""Tests for the engines listing endpoint."""


async def test_list_engines(client):
    """GET /engines returns all available engines."""
    resp = await client.get("/engines")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 5

    names = {e["name"] for e in data}
    assert names == {"whisper", "qwen3", "paraformer", "openai-whisper", "alibaba-asr"}


async def test_engine_capabilities_whisper(client):
    resp = await client.get("/engines")
    engines = {e["name"]: e for e in resp.json()}

    whisper = engines["whisper"]
    assert "en" in whisper["supported_languages"]
    assert "zh" in whisper["supported_languages"]
    assert whisper["is_loaded"] is False
    assert len(whisper["model_sizes"]) >= 4


async def test_engine_capabilities_qwen3(client):
    resp = await client.get("/engines")
    engines = {e["name"]: e for e in resp.json()}

    qwen3 = engines["qwen3"]
    assert "zh" in qwen3["supported_languages"]
    assert "yue" in qwen3["supported_languages"]  # Cantonese dialect
    assert qwen3["supports_streaming"] is True


async def test_engine_capabilities_paraformer(client):
    resp = await client.get("/engines")
    engines = {e["name"]: e for e in resp.json()}

    paraformer = engines["paraformer"]
    assert "zh" in paraformer["supported_languages"]
    assert paraformer["supports_timestamps"] is True


# --- Load endpoint tests ---


async def test_load_returns_loading_status(client):
    """POST /engines/{name}/load returns loading status immediately."""
    resp = await client.post("/engines/whisper/load?model_size=base")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("loading", "already_loaded")
    assert data["engine_name"] == "whisper"
    assert data["model_size"] == "base"


async def test_load_invalid_model_size(client):
    """POST /engines/{name}/load with invalid model_size returns 400."""
    resp = await client.post("/engines/whisper/load?model_size=nonexistent")
    assert resp.status_code == 400
    assert "nonexistent" in resp.json()["detail"]


async def test_load_unknown_engine(client):
    """POST /engines/{name}/load with unknown engine returns 404."""
    resp = await client.post("/engines/unknown/load?model_size=base")
    assert resp.status_code == 404


async def test_load_missing_model_size(client):
    """POST /engines/{name}/load without model_size returns 422."""
    resp = await client.post("/engines/whisper/load")
    assert resp.status_code == 422


# --- Load status endpoint tests ---


async def test_load_status_idle(client):
    """GET /engines/{name}/load-status returns idle when no load started."""
    resp = await client.get("/engines/whisper/load-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["phase"] == "idle"
    assert data["engine_name"] == "whisper"
    assert data["elapsed_seconds"] == 0.0
    assert data["error"] is None


async def test_load_status_unknown_engine(client):
    """GET /engines/{name}/load-status with unknown engine returns 404."""
    resp = await client.get("/engines/unknown/load-status")
    assert resp.status_code == 404


async def test_load_status_after_load_started(client):
    """GET /engines/{name}/load-status shows active phase after load."""
    await client.post("/engines/whisper/load?model_size=base")
    resp = await client.get("/engines/whisper/load-status")
    assert resp.status_code == 200
    data = resp.json()
    # Phase should be preparing, loading, ready, or error
    assert data["phase"] in ("preparing", "loading", "ready", "error")
    assert data["model_size"] == "base"


# --- Unload endpoint tests ---


async def test_unload_clears_loading_state(client):
    """POST /engines/{name}/unload clears loading status."""
    await client.post("/engines/whisper/load?model_size=base")
    resp = await client.post("/engines/whisper/unload")
    assert resp.status_code == 200

    # After unload, status should be idle
    status_resp = await client.get("/engines/whisper/load-status")
    data = status_resp.json()
    assert data["phase"] == "idle"


async def test_unload_unknown_engine(client):
    """POST /engines/{name}/unload with unknown engine returns 404."""
    resp = await client.post("/engines/unknown/unload")
    assert resp.status_code == 404
