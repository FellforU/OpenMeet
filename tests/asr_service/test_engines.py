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
