async def test_create_and_start_job_no_file_returns_error(client):
    """Starting a job without providing audio should fail."""
    create_resp = await client.post("/jobs", json={"engine": "whisper"})
    job_id = create_resp.json()["id"]
    start_resp = await client.post(f"/jobs/{job_id}/start")
    assert start_resp.status_code == 400


async def test_get_job_result_before_completion(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    result_resp = await client.get(f"/jobs/{job_id}/result")
    assert result_resp.status_code == 400
