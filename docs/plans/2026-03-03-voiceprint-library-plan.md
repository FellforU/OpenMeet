# Voiceprint Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persistent voiceprint library using ECAPA-TDNN embeddings stored in SQLite, enabling automatic cross-meeting speaker identification with passive learning.

**Architecture:** Python ASR service extracts per-segment ECAPA-TDNN embeddings during post-processing and returns them alongside segments. Frontend passes embeddings to Rust/Tauri commands that handle all voiceprint matching, creation, and updates against SQLite. SpeakerBadge UI is upgraded to a selector with voiceprint-aware rename/assign workflow.

**Tech Stack:** FunASR ECAPA-TDNN (Python), SQLite BLOB (Rust/rusqlite), Zustand store (TypeScript), React UI components

**Design doc:** `docs/plans/2026-03-03-voiceprint-library-design.md`

---

## Phase 1: Database & Rust Backend

### Task 1: Create voiceprints table and Segment schema update

**Files:**
- Modify: `src-tauri/src/database.rs:27-96` (init method, table creation)
- Modify: `src-tauri/src/database.rs:125-133` (Segment struct)

**Step 1: Add voiceprints table creation in `Database::init()`**

In `database.rs`, after the existing `CREATE TABLE IF NOT EXISTS segments` block (line 57), add:

```rust
conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS voiceprints (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL DEFAULT '',
        nickname      TEXT DEFAULT '',
        email         TEXT DEFAULT '',
        department    TEXT DEFAULT '',
        title         TEXT DEFAULT '',
        note          TEXT DEFAULT '',
        avatar_path   TEXT,
        embedding     BLOB NOT NULL,
        sample_count  INTEGER NOT NULL DEFAULT 1,
        model_version TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        last_seen_at  TEXT
    );
    "
)?;
```

**Step 2: Add `voiceprint_id` column to segments table**

After the voiceprints table creation, add migration logic:

```rust
// Add voiceprint_id column to segments if not exists
let has_voiceprint_id: bool = conn
    .prepare("SELECT voiceprint_id FROM segments LIMIT 0")
    .is_ok();
if !has_voiceprint_id {
    conn.execute_batch(
        "ALTER TABLE segments ADD COLUMN voiceprint_id TEXT REFERENCES voiceprints(id);"
    )?;
}
```

**Step 3: Update Segment struct to include voiceprint_id**

Modify the `Segment` struct (line 125):

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct Segment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: Option<f64>,
    pub voiceprint_id: Option<String>,
}
```

**Step 4: Update `db_save_segments` to persist voiceprint_id**

Modify the INSERT statement in `db_save_segments` (line 458) to include the new column:

```rust
tx.execute(
    "INSERT INTO segments (id, project_id, idx, start_time, end_time, text, speaker, confidence, voiceprint_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    params![
        seg.id,
        project_id,
        i as i32,
        seg.start,
        seg.end,
        seg.text,
        seg.speaker,
        seg.confidence,
        seg.voiceprint_id,
    ],
)?;
```

Also update `db_get_segments` to read `voiceprint_id` from the query.

**Step 5: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Compilation succeeds

**Step 6: Commit**

```bash
git add src-tauri/src/database.rs
git commit -m "feat(db): add voiceprints table and voiceprint_id to segments"
```

---

### Task 2: Voiceprint CRUD Tauri commands

**Files:**
- Modify: `src-tauri/src/database.rs` (add CRUD functions)
- Modify: `src-tauri/src/lib.rs:222-264` (register new commands)

**Step 1: Define Rust structs for voiceprint data**

Add to `database.rs`:

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct VoiceprintInfo {
    pub id: String,
    pub name: String,
    pub nickname: String,
    pub email: String,
    pub department: String,
    pub title: String,
    pub note: String,
    pub avatar_path: Option<String>,
    pub sample_count: i32,
    pub model_version: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_seen_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct VoiceprintMetadata {
    pub name: Option<String>,
    pub nickname: Option<String>,
    pub email: Option<String>,
    pub department: Option<String>,
    pub title: Option<String>,
    pub note: Option<String>,
    pub avatar_path: Option<String>,
}
```

**Step 2: Implement voiceprint_list command**

```rust
#[tauri::command]
pub fn voiceprint_list(state: State<DatabaseState>) -> Result<Vec<VoiceprintInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, nickname, email, department, title, note, avatar_path,
                    sample_count, model_version, created_at, updated_at, last_seen_at
             FROM voiceprints ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC"
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(VoiceprintInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                nickname: row.get(2)?,
                email: row.get(3)?,
                department: row.get(4)?,
                title: row.get(5)?,
                note: row.get(6)?,
                avatar_path: row.get(7)?,
                sample_count: row.get(8)?,
                model_version: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                last_seen_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
```

**Step 3: Implement voiceprint_update command**

```rust
#[tauri::command]
pub fn voiceprint_update(
    state: State<DatabaseState>,
    id: String,
    metadata: VoiceprintMetadata,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Build dynamic SET clause from non-None fields
    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut param_idx = 2u32;
    // Use a simple approach: update all fields, using COALESCE to keep existing values
    conn.execute(
        "UPDATE voiceprints SET
            name = COALESCE(?2, name),
            nickname = COALESCE(?3, nickname),
            email = COALESCE(?4, email),
            department = COALESCE(?5, department),
            title = COALESCE(?6, title),
            note = COALESCE(?7, note),
            avatar_path = COALESCE(?8, avatar_path),
            updated_at = ?1
         WHERE id = ?9",
        params![
            now,
            metadata.name,
            metadata.nickname,
            metadata.email,
            metadata.department,
            metadata.title,
            metadata.note,
            metadata.avatar_path,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 4: Implement voiceprint_delete command**

```rust
#[tauri::command]
pub fn voiceprint_delete(state: State<DatabaseState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Nullify voiceprint_id references in segments, keep speaker text
    conn.execute(
        "UPDATE segments SET voiceprint_id = NULL WHERE voiceprint_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM voiceprints WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 5: Implement voiceprint_merge command**

```rust
#[tauri::command]
pub fn voiceprint_merge(
    state: State<DatabaseState>,
    source_id: String,
    target_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // Read both embeddings
    let (src_emb, src_count): (Vec<u8>, i32) = tx
        .query_row(
            "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
            params![source_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let (tgt_emb, tgt_count): (Vec<u8>, i32) = tx
        .query_row(
            "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
            params![target_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // Weighted average of embeddings
    let merged = weighted_average_embeddings(&src_emb, src_count, &tgt_emb, tgt_count);
    let new_count = src_count + tgt_count;
    let now = chrono::Utc::now().to_rfc3339();

    // Update target with merged embedding
    tx.execute(
        "UPDATE voiceprints SET embedding = ?1, sample_count = ?2, updated_at = ?3 WHERE id = ?4",
        params![merged, new_count, now, target_id],
    )
    .map_err(|e| e.to_string())?;

    // Move segment references from source to target
    tx.execute(
        "UPDATE segments SET voiceprint_id = ?1 WHERE voiceprint_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete source
    tx.execute("DELETE FROM voiceprints WHERE id = ?1", params![source_id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 6: Implement helper `weighted_average_embeddings`**

```rust
/// Compute weighted average of two f32 embedding BLOBs, returns L2-normalized result.
fn weighted_average_embeddings(a: &[u8], count_a: i32, b: &[u8], count_b: i32) -> Vec<u8> {
    let dim = a.len() / 4; // f32 = 4 bytes
    let mut result = Vec::with_capacity(a.len());
    let total = (count_a + count_b) as f32;
    let wa = count_a as f32 / total;
    let wb = count_b as f32 / total;

    let mut norm_sq: f32 = 0.0;
    let mut floats = Vec::with_capacity(dim);
    for i in 0..dim {
        let va = f32::from_le_bytes([a[i*4], a[i*4+1], a[i*4+2], a[i*4+3]]);
        let vb = f32::from_le_bytes([b[i*4], b[i*4+1], b[i*4+2], b[i*4+3]]);
        let v = va * wa + vb * wb;
        floats.push(v);
        norm_sq += v * v;
    }

    let norm = norm_sq.sqrt().max(1e-12);
    for v in floats {
        result.extend_from_slice(&(v / norm).to_le_bytes());
    }
    result
}
```

**Step 7: Register all new commands in `lib.rs`**

Add to the `generate_handler!` macro in `lib.rs` (after line 251):

```rust
database::voiceprint_list,
database::voiceprint_update,
database::voiceprint_delete,
database::voiceprint_merge,
database::voiceprint_match,
```

**Step 8: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Compilation succeeds

**Step 9: Commit**

```bash
git add src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat(db): add voiceprint CRUD and merge Tauri commands"
```

---

### Task 3: Voiceprint matching command (core algorithm)

**Files:**
- Modify: `src-tauri/src/database.rs` (add voiceprint_match)

**Step 1: Define match result types**

```rust
#[derive(Serialize, Deserialize)]
pub struct VoiceprintMatchResult {
    /// For each input embedding: matched voiceprint_id (or newly created one)
    pub assignments: Vec<Option<String>>,
    /// Speaker display names corresponding to assignments
    pub speaker_names: Vec<Option<String>>,
    /// Newly created voiceprint IDs (so frontend knows which are new)
    pub new_voiceprint_ids: Vec<String>,
}
```

**Step 2: Implement voiceprint_match command**

This is the core algorithm — takes segment embeddings, compares against the voiceprint library, creates new entries for unknowns.

```rust
#[tauri::command]
pub fn voiceprint_match(
    state: State<DatabaseState>,
    embeddings: Vec<Option<Vec<f32>>>,
    threshold: f64,
) -> Result<VoiceprintMatchResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Load all voiceprint embeddings from DB
    let mut stmt = conn
        .prepare("SELECT id, name, embedding, sample_count FROM voiceprints")
        .map_err(|e| e.to_string())?;
    let library: Vec<(String, String, Vec<u8>, i32)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let threshold_f32 = threshold as f32;
    let mut assignments: Vec<Option<String>> = vec![None; embeddings.len()];
    let mut speaker_names: Vec<Option<String>> = vec![None; embeddings.len()];
    let mut new_ids: Vec<String> = Vec::new();

    // 2. For each embedding, find best match in library
    // Track unmatched embeddings for clustering
    let mut unmatched: Vec<(usize, Vec<f32>)> = Vec::new();

    for (i, emb_opt) in embeddings.iter().enumerate() {
        let emb = match emb_opt {
            Some(e) => e,
            None => continue,
        };

        let mut best_sim: f32 = -1.0;
        let mut best_id: Option<String> = None;
        let mut best_name: Option<String> = None;

        for (vp_id, vp_name, vp_blob, _) in &library {
            let sim = cosine_similarity_blob(emb, vp_blob);
            if sim > best_sim {
                best_sim = sim;
                best_id = Some(vp_id.clone());
                best_name = Some(vp_name.clone());
            }
        }

        if best_sim >= threshold_f32 {
            assignments[i] = best_id;
            speaker_names[i] = best_name;
        } else {
            unmatched.push((i, emb.clone()));
        }
    }

    // 3. Cluster unmatched embeddings (greedy, same as campplus.py)
    let clusters = greedy_cluster(&unmatched, threshold_f32);

    // 4. For each cluster, create a new voiceprint entry
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // Count existing unnamed speakers for naming
    let existing_unknown: i32 = tx
        .query_row(
            "SELECT COUNT(*) FROM voiceprints WHERE name LIKE '未知说话人%'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (cluster_idx, member_indices) in clusters.iter().enumerate() {
        let vp_id = uuid::Uuid::new_v4().to_string();
        let speaker_num = existing_unknown + cluster_idx as i32 + 1;
        let name = format!("未知说话人 {}", speaker_num);

        // Average embedding for the cluster
        let avg_emb = average_embeddings(
            &member_indices.iter().map(|&mi| &unmatched[mi].1).collect::<Vec<_>>()
        );
        let blob = f32_vec_to_blob(&avg_emb);

        tx.execute(
            "INSERT INTO voiceprints (id, name, embedding, sample_count, model_version, created_at, updated_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, '', ?5, ?5, ?5)",
            params![vp_id, name, blob, member_indices.len() as i32, now],
        )
        .map_err(|e| e.to_string())?;

        new_ids.push(vp_id.clone());

        for &mi in member_indices {
            let seg_idx = unmatched[mi].0;
            assignments[seg_idx] = Some(vp_id.clone());
            speaker_names[seg_idx] = Some(name.clone());
        }
    }

    // 5. Update last_seen_at for matched voiceprints
    for assignment in &assignments {
        if let Some(vp_id) = assignment {
            if !new_ids.contains(vp_id) {
                tx.execute(
                    "UPDATE voiceprints SET last_seen_at = ?1 WHERE id = ?2",
                    params![now, vp_id],
                ).ok();
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(VoiceprintMatchResult {
        assignments,
        speaker_names,
        new_voiceprint_ids: new_ids,
    })
}
```

**Step 3: Implement helper functions**

```rust
fn cosine_similarity_blob(emb: &[f32], blob: &[u8]) -> f32 {
    let dim = blob.len() / 4;
    if emb.len() != dim { return -1.0; }
    let mut dot: f32 = 0.0;
    let mut norm_a: f32 = 0.0;
    let mut norm_b: f32 = 0.0;
    for i in 0..dim {
        let b = f32::from_le_bytes([blob[i*4], blob[i*4+1], blob[i*4+2], blob[i*4+3]]);
        dot += emb[i] * b;
        norm_a += emb[i] * emb[i];
        norm_b += b * b;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-12 { 0.0 } else { dot / denom }
}

fn greedy_cluster(items: &[(usize, Vec<f32>)], threshold: f32) -> Vec<Vec<usize>> {
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let mut centroids: Vec<Vec<f32>> = Vec::new();

    for (item_idx, (_, emb)) in items.iter().enumerate() {
        let mut best_cluster = None;
        let mut best_sim: f32 = -1.0;

        for (ci, centroid) in centroids.iter().enumerate() {
            let sim = cosine_similarity_vec(emb, centroid);
            if sim > best_sim {
                best_sim = sim;
                best_cluster = Some(ci);
            }
        }

        if best_sim >= threshold && best_cluster.is_some() {
            let ci = best_cluster.unwrap();
            clusters[ci].push(item_idx);
            // Update centroid
            let members: Vec<&Vec<f32>> = clusters[ci].iter().map(|&mi| &items[mi].1).collect();
            centroids[ci] = average_embeddings(&members);
        } else {
            clusters.push(vec![item_idx]);
            centroids.push(emb.clone());
        }
    }
    clusters
}

fn cosine_similarity_vec(a: &[f32], b: &[f32]) -> f32 {
    let mut dot: f32 = 0.0;
    let mut na: f32 = 0.0;
    let mut nb: f32 = 0.0;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom < 1e-12 { 0.0 } else { dot / denom }
}

fn average_embeddings(vecs: &[&Vec<f32>]) -> Vec<f32> {
    if vecs.is_empty() { return Vec::new(); }
    let dim = vecs[0].len();
    let mut avg = vec![0.0f32; dim];
    for v in vecs {
        for i in 0..dim {
            avg[i] += v[i];
        }
    }
    let n = vecs.len() as f32;
    let mut norm: f32 = 0.0;
    for v in &mut avg {
        *v /= n;
        norm += *v * *v;
    }
    let norm = norm.sqrt().max(1e-12);
    for v in &mut avg { *v /= norm; }
    avg
}

fn f32_vec_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}
```

**Step 4: Add uuid dependency to Cargo.toml**

Check if `uuid` is already a dependency. If not, add:

```toml
uuid = { version = "1", features = ["v4"] }
```

**Step 5: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Compilation succeeds

**Step 6: Commit**

```bash
git add src-tauri/src/database.rs src-tauri/Cargo.toml
git commit -m "feat(db): add voiceprint_match command with cosine similarity and clustering"
```

---

## Phase 2: Python ASR — ECAPA-TDNN Embedding Extraction

### Task 4: Add ECAPA-TDNN embedding extractor

**Files:**
- Create: `asr_service/processors/diarization/ecapa_tdnn.py`
- Modify: `asr_service/processors/diarization/factory.py`
- Modify: `asr_service/processors/model_utils.py` (add model dir constant)

**Step 1: Create ECAPA-TDNN embedding extractor**

Create `asr_service/processors/diarization/ecapa_tdnn.py`:

```python
"""ECAPA-TDNN speaker embedding extraction.

Extracts 192-dimensional speaker embeddings per segment.
Used by voiceprint library for speaker identification.
"""

import asyncio
import logging
from typing import Optional

import numpy as np

from asr_service.models.job import Segment
from asr_service.processors.model_utils import resolve_modelscope_model

logger = logging.getLogger(__name__)

ECAPA_MODEL_DIR = "speech_eres2net_sv_zh-cn_16k-common"
MIN_SEGMENT_DURATION = 0.3


class EcapaTdnnExtractor:
    """Speaker embedding extraction using ECAPA-TDNN / ERes2Net."""

    def __init__(self):
        self._model = None

    def _resolve_model_path(self) -> Optional[str]:
        return resolve_modelscope_model(ECAPA_MODEL_DIR)

    async def load(self) -> None:
        if self._model:
            return

        model_path = self._resolve_model_path()
        if not model_path:
            logger.info("ECAPA-TDNN model not found locally, skipping")
            return

        def _load():
            try:
                import torch
                from funasr import AutoModel
                device = "cuda" if torch.cuda.is_available() else "cpu"
                return AutoModel(model=model_path, device=device)
            except Exception as e:
                logger.warning("Failed to load ECAPA-TDNN from %s: %s", model_path, e)
                return None

        self._model = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._model is not None

    async def extract_embeddings(
        self, audio_path: str, segments: list[Segment]
    ) -> list[Optional[list[float]]]:
        """Extract one embedding per segment. Returns list aligned with segments.

        None for segments that are too short or fail extraction.
        """
        if not self._model:
            await self.load()

        if not self._model:
            return [None] * len(segments)

        model_ref = self._model

        def _extract():
            import torchaudio

            waveform, sr = torchaudio.load(audio_path)
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)
            if sr != 16000:
                waveform = torchaudio.transforms.Resample(sr, 16000)(waveform)
                sr = 16000

            audio_np = waveform.squeeze(0).numpy()
            results: list[Optional[list[float]]] = []

            for seg in segments:
                start_sample = int(seg.start * sr)
                end_sample = int(seg.end * sr)
                chunk = audio_np[start_sample:end_sample]

                if len(chunk) < int(MIN_SEGMENT_DURATION * sr):
                    results.append(None)
                    continue

                try:
                    result = model_ref.generate(input=chunk)
                    emb = _parse_embedding(result)
                    if emb is not None:
                        # L2 normalize
                        norm = np.linalg.norm(emb)
                        if norm > 0:
                            emb = emb / norm
                        results.append(emb.tolist())
                    else:
                        results.append(None)
                except Exception:
                    results.append(None)

            return results

        return await asyncio.to_thread(_extract)


def _parse_embedding(result) -> Optional[np.ndarray]:
    """Parse FunASR model output to extract embedding vector."""
    if not result:
        return None

    if isinstance(result, list) and len(result) > 0:
        item = result[0]
        if isinstance(item, dict):
            emb = item.get("spk_embedding")
            if emb is not None:
                return np.asarray(emb, dtype=np.float32).flatten()
        if isinstance(item, np.ndarray):
            return item.astype(np.float32).flatten()

    if isinstance(result, np.ndarray):
        return result.astype(np.float32).flatten()

    return None
```

**Step 2: Update factory to expose ECAPA-TDNN**

Modify `asr_service/processors/diarization/factory.py` to add a helper:

```python
from asr_service.processors.diarization.ecapa_tdnn import EcapaTdnnExtractor

def create_embedding_extractor():
    """Create the ECAPA-TDNN embedding extractor (language-independent)."""
    return EcapaTdnnExtractor()
```

**Step 3: Verify Python syntax**

Run: `python3 -c "import ast; ast.parse(open('asr_service/processors/diarization/ecapa_tdnn.py').read()); print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add asr_service/processors/diarization/ecapa_tdnn.py asr_service/processors/diarization/factory.py
git commit -m "feat(asr): add ECAPA-TDNN speaker embedding extractor"
```

---

### Task 5: Modify post-process to return embeddings

**Files:**
- Modify: `asr_service/services/post_processing.py`
- Modify: `asr_service/routers/jobs.py` (response models)
- Modify: `asr_service/models/job.py` (add embeddings field to TranscriptionJob)

**Step 1: Add embeddings field to TranscriptionJob**

In `asr_service/models/job.py`, add to the `TranscriptionJob` dataclass:

```python
embeddings: list[Optional[list[float]]] = field(default_factory=list)
```

**Step 2: Update PostProcessingPipeline to extract embeddings**

In `asr_service/services/post_processing.py`, add embedding extraction step after diarization:

```python
from asr_service.processors.diarization.factory import create_embedding_extractor

# In run() method, after diarization step, add:

# Step 4: Extract speaker embeddings for voiceprint matching
try:
    extractor = create_embedding_extractor()
    job.embeddings = await extractor.extract_embeddings(job.audio_path, segments)
except Exception as e:
    logger.warning("Embedding extraction failed: %s", e)
    job.embeddings = []
```

**Step 3: Update JobResultResponse to include embeddings**

In `asr_service/routers/jobs.py`, update `JobResultResponse`:

```python
class JobResultResponse(BaseModel):
    id: str
    status: str
    segments: list[SegmentResponse]
    summary: Optional[dict] = None
    embeddings: Optional[list[Optional[list[float]]]] = None
```

Update the `get_job_result` endpoint to include embeddings:

```python
return JobResultResponse(
    id=job.id,
    status=job.status.value,
    segments=[...],
    summary=job.summary,
    embeddings=job.embeddings if job.embeddings else None,
)
```

**Step 4: Verify Python syntax**

Run: `python3 -c "import ast; ast.parse(open('asr_service/services/post_processing.py').read()); print('OK')"`
Expected: `OK`

**Step 5: Commit**

```bash
git add asr_service/models/job.py asr_service/services/post_processing.py asr_service/routers/jobs.py
git commit -m "feat(asr): return per-segment embeddings from post-process endpoint"
```

---

## Phase 3: Frontend — Integration & Voiceprint Store

### Task 6: Create voiceprintStore

**Files:**
- Create: `src/stores/voiceprintStore.ts`
- Modify: `src/types/index.ts` (add Voiceprint types)

**Step 1: Add TypeScript types**

In `src/types/index.ts`, add:

```typescript
export interface VoiceprintInfo {
  id: string;
  name: string;
  nickname: string;
  email: string;
  department: string;
  title: string;
  note: string;
  avatarPath: string | null;
  sampleCount: number;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface VoiceprintMetadata {
  name?: string;
  nickname?: string;
  email?: string;
  department?: string;
  title?: string;
  note?: string;
  avatarPath?: string;
}

export interface VoiceprintMatchResult {
  assignments: (string | null)[];
  speaker_names: (string | null)[];
  new_voiceprint_ids: string[];
}
```

**Step 2: Create voiceprintStore**

Create `src/stores/voiceprintStore.ts`:

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { VoiceprintInfo, VoiceprintMetadata, VoiceprintMatchResult } from "../types";

interface VoiceprintStore {
  voiceprints: VoiceprintInfo[];
  loading: boolean;

  loadVoiceprints: () => Promise<void>;
  updateVoiceprint: (id: string, metadata: VoiceprintMetadata) => Promise<void>;
  deleteVoiceprint: (id: string) => Promise<void>;
  mergeVoiceprints: (sourceId: string, targetId: string) => Promise<void>;
  matchEmbeddings: (
    embeddings: (number[] | null)[],
    threshold: number,
  ) => Promise<VoiceprintMatchResult>;
}

export const useVoiceprintStore = create<VoiceprintStore>((set, get) => ({
  voiceprints: [],
  loading: false,

  loadVoiceprints: async () => {
    set({ loading: true });
    try {
      const list = await invoke<VoiceprintInfo[]>("voiceprint_list");
      set({ voiceprints: list });
    } finally {
      set({ loading: false });
    }
  },

  updateVoiceprint: async (id, metadata) => {
    await invoke("voiceprint_update", { id, metadata });
    await get().loadVoiceprints();
  },

  deleteVoiceprint: async (id) => {
    await invoke("voiceprint_delete", { id });
    set({ voiceprints: get().voiceprints.filter((v) => v.id !== id) });
  },

  mergeVoiceprints: async (sourceId, targetId) => {
    await invoke("voiceprint_merge", { sourceId, targetId });
    await get().loadVoiceprints();
  },

  matchEmbeddings: async (embeddings, threshold) => {
    return await invoke<VoiceprintMatchResult>("voiceprint_match", {
      embeddings,
      threshold,
    });
  },
}));
```

**Step 3: Update Segment type to include voiceprintId**

In `src/types/index.ts`, update:

```typescript
export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
  voiceprintId?: string | null;
}
```

**Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/stores/voiceprintStore.ts src/types/index.ts
git commit -m "feat(store): add voiceprintStore and Voiceprint types"
```

---

### Task 7: Integrate voiceprint matching into recording flow

**Files:**
- Modify: `src/stores/recordingStore.ts:359-395` (diarization section in stopRecording)
- Modify: `src/stores/settingsStore.ts` (add diarizationThreshold)

**Step 1: Add diarizationThreshold to settings**

In `src/stores/settingsStore.ts`, add to `GeneralConfig` interface:

```typescript
diarizationThreshold: number;  // Voiceprint matching threshold (0.0-1.0)
```

And to `defaultState.general`:

```typescript
diarizationThreshold: 0.65,
```

**Step 2: Rewrite diarization section in stopRecording**

Replace lines 359-395 in `recordingStore.ts`:

```typescript
// Run post-processing and voiceprint matching
const currentSessionSegmentCount = segments.length - capturedSegmentCountAtStart;
if (capturedJobId && audioPath && currentSessionSegmentCount > 0) {
  set({ processingStep: "diarizing" });
  try {
    // Post-process returns segments + embeddings
    await api.postProcessJob(capturedJobId, audioPath);
    const result = await tauriFetch(
      `http://127.0.0.1:18090/jobs/${capturedJobId}/result`,
      { method: "GET" }
    );
    if (result.status >= 200 && result.status < 300) {
      const data = JSON.parse(result.body);
      const postProcessedSegments: Segment[] = data.segments.map(
        (s: { start: number; end: number; text: string; speaker: string | null; confidence: number | null }) => ({
          id: crypto.randomUUID(),
          start: s.start,
          end: s.end,
          text: s.text,
          speaker: s.speaker || null,
          confidence: s.confidence || null,
        })
      );

      // Voiceprint matching: pass embeddings to Rust for library comparison
      const embeddings: (number[] | null)[] = data.embeddings || [];
      if (embeddings.length > 0) {
        try {
          const threshold = useSettingsStore.getState().general.diarizationThreshold;
          const matchResult = await invoke<VoiceprintMatchResult>(
            "voiceprint_match",
            { embeddings, threshold }
          );
          // Apply voiceprint assignments to segments
          for (let i = 0; i < postProcessedSegments.length; i++) {
            if (matchResult.assignments[i]) {
              postProcessedSegments[i].voiceprintId = matchResult.assignments[i];
            }
            if (matchResult.speaker_names[i]) {
              postProcessedSegments[i].speaker = matchResult.speaker_names[i];
            }
          }
        } catch {
          // Voiceprint matching failure is non-fatal
        }
      }

      // Merge: keep pre-existing segments, replace current session's portion
      const allSegments = useTranscriptionStore.getState().segments;
      const previousSegments = allSegments.slice(0, capturedSegmentCountAtStart);
      const mergedSegments = [...previousSegments, ...postProcessedSegments];
      useTranscriptionStore.getState().setSegments(mergedSegments);

      // Re-persist updated segments with speaker labels
      if (activeProjectId) {
        await useTranscriptionStore.getState().persistSegments(activeProjectId);
      }
    }
  } catch {
    // Diarization failure is non-fatal
  }
}
```

**Step 3: Add VoiceprintMatchResult import**

At top of `recordingStore.ts`:

```typescript
import type { Segment, VoiceprintMatchResult } from "../types";
```

**Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/stores/recordingStore.ts src/stores/settingsStore.ts
git commit -m "feat(recording): integrate voiceprint matching into stop recording flow"
```

---

## Phase 4: Frontend — Voiceprint Management UI

### Task 8: Voiceprint library management page

**Files:**
- Create: `src/components/VoiceprintLibrary/VoiceprintList.tsx`
- Create: `src/components/VoiceprintLibrary/VoiceprintEditDialog.tsx`
- Integrate into settings or sidebar navigation

This task creates the voiceprint management UI with:
- List view sorted by last_seen_at
- Edit dialog for metadata (name, nickname, email, department, title, note)
- Delete confirmation
- Merge selection (select 2 → merge button)

Implementation details depend on where the page is placed in navigation. Recommend adding a "音色库" tab in the sidebar or a section in Settings.

**Step 1:** Create `VoiceprintList.tsx` — table/list of voiceprints with actions
**Step 2:** Create `VoiceprintEditDialog.tsx` — form dialog for editing metadata
**Step 3:** Add i18n keys for voiceprint UI labels
**Step 4:** Register route/tab for voiceprint management
**Step 5:** Verify build
**Step 6:** Commit

```bash
git commit -m "feat(ui): add voiceprint library management page"
```

---

### Task 9: Upgrade SpeakerBadge to voiceprint-aware selector

**Files:**
- Modify: `src/components/Workspace/SpeakerBadge.tsx`
- Modify: `src/components/Workspace/TranscriptPanel.tsx`

Replace the simple text input popover with a voiceprint-aware selector:

**Step 1:** Rewrite SpeakerBadge popover to show:
- Search input
- Recommended matches (if segment has embedding similarity data)
- Full voiceprint list
- "Input new name" option
- "Create new voiceprint" option

**Step 2:** Add `onAssignVoiceprint` callback prop alongside existing `onRename`

**Step 3:** In TranscriptPanel, wire up the new callback to update segment's `voiceprintId` and trigger passive learning

**Step 4:** Implement passive learning trigger — when user confirms/corrects a speaker assignment:

```typescript
// In transcriptionStore or voiceprintStore:
async function passiveLearningUpdate(voiceprintId: string, embedding: number[]) {
  await invoke("voiceprint_passive_learn", { id: voiceprintId, newEmbedding: embedding });
}
```

This requires a corresponding Rust command `voiceprint_passive_learn` that does the rolling average update.

**Step 5:** Verify build
**Step 6:** Commit

```bash
git commit -m "feat(ui): upgrade SpeakerBadge to voiceprint-aware selector with passive learning"
```

---

### Task 10: Add passive learning Tauri command

**Files:**
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs` (register command)

**Step 1: Implement voiceprint_passive_learn**

```rust
#[tauri::command]
pub fn voiceprint_passive_learn(
    state: State<DatabaseState>,
    id: String,
    new_embedding: Vec<f32>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let (old_blob, count): (Vec<u8>, i32) = conn
        .query_row(
            "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let dim = new_embedding.len();
    let max_count = 100;

    let updated_blob = if count >= max_count {
        // Exponential decay: old * 0.95 + new * 0.05
        blend_embeddings(&old_blob, &new_embedding, 0.95, 0.05)
    } else {
        // Rolling average
        let w_old = count as f32 / (count as f32 + 1.0);
        let w_new = 1.0 / (count as f32 + 1.0);
        blend_embeddings(&old_blob, &new_embedding, w_old, w_new)
    };

    let new_count = (count + 1).min(max_count);

    conn.execute(
        "UPDATE voiceprints SET embedding = ?1, sample_count = ?2, updated_at = ?3 WHERE id = ?4",
        params![updated_blob, new_count, now, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn blend_embeddings(old_blob: &[u8], new_emb: &[f32], w_old: f32, w_new: f32) -> Vec<u8> {
    let dim = new_emb.len();
    let mut result = Vec::with_capacity(dim * 4);
    let mut norm_sq: f32 = 0.0;
    let mut floats = Vec::with_capacity(dim);

    for i in 0..dim {
        let old_v = f32::from_le_bytes([
            old_blob[i*4], old_blob[i*4+1], old_blob[i*4+2], old_blob[i*4+3]
        ]);
        let v = old_v * w_old + new_emb[i] * w_new;
        floats.push(v);
        norm_sq += v * v;
    }

    let norm = norm_sq.sqrt().max(1e-12);
    for v in floats {
        result.extend_from_slice(&(v / norm).to_le_bytes());
    }
    result
}
```

**Step 2: Register command in lib.rs**

Add `database::voiceprint_passive_learn` to the `generate_handler!` list.

**Step 3: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat(db): add voiceprint passive learning command"
```

---

## Phase 5: Settings & Polish

### Task 11: Add voiceprint settings to Settings UI

**Files:**
- Modify settings page component to include:
  - Diarization threshold slider (0.0 - 1.0, default 0.65)
  - Link to voiceprint library management page

### Task 12: Add i18n translations

**Files:**
- Modify: `src/i18n/locales/zh/workspace.json`
- Modify: `src/i18n/locales/en/workspace.json`
- Add keys for: voiceprint library, speaker selector, settings labels

### Task 13: End-to-end testing

**Manual test plan:**
1. Start fresh (empty voiceprint library)
2. Record a meeting with 2+ speakers
3. Stop recording → verify post-process extracts embeddings
4. Verify voiceprint_match creates new "未知说话人" entries
5. Open voiceprint library → verify entries exist
6. Edit "未知说话人 1" → rename to real name
7. Record another meeting with same speakers
8. Verify speakers are auto-identified with correct names
9. Verify passive learning updates embeddings
10. Test merge: merge two voiceprints → verify segments update
11. Test delete: delete voiceprint → verify segments fallback to text
