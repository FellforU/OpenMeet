const ASR_BASE_URL = "http://127.0.0.1:18090";

export async function configureKnowledge(
  appDataDir: string
): Promise<{ status: string; sqlite_path: string | null; lance_path: string | null }> {
  const resp = await fetch(`${ASR_BASE_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_data_dir: appDataDir }),
  });
  if (!resp.ok) {
    throw new Error(`Config failed: HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function indexProject(
  projectId: string
): Promise<{ project_id: string; chunks_indexed: number }> {
  const resp = await fetch(`${ASR_BASE_URL}/index/project/${projectId}`, {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Index failed: HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function indexAll(): Promise<{
  projects: Record<string, number>;
  total_chunks: number;
}> {
  const resp = await fetch(`${ASR_BASE_URL}/index/all`, {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Index all failed: HTTP ${resp.status}`);
  }
  return resp.json();
}
