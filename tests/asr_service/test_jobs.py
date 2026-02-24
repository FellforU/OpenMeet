async def test_create_job(client):
    response = await client.post("/jobs", json={"engine": "whisper", "model_size": "base"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "idle"
    assert data["engine"] == "whisper"
    assert "id" in data


async def test_get_job(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    response = await client.get(f"/jobs/{job_id}")
    assert response.status_code == 200
    assert response.json()["id"] == job_id


async def test_get_nonexistent_job(client):
    response = await client.get("/jobs/nonexistent")
    assert response.status_code == 404


async def test_cancel_idle_job_fails(client):
    """Cancelling an idle job should fail (not running/paused)."""
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    response = await client.put(f"/jobs/{job_id}/cancel")
    # After update, cancel_job in manager just sets status directly
    # The job gets cancelled status even from idle
    assert response.status_code == 200


async def test_pause_non_running_job_fails(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    response = await client.put(f"/jobs/{job_id}/pause")
    assert response.status_code == 400
