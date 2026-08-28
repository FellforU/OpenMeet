/**
 * 声纹 embedding 聚合工具。
 *
 * 逐段提取的 embedding 波动较大，直接送去声纹匹配会被贪心聚类
 * 切成大量小簇，导致音色库里出现成片的"未知说话人"。
 * 按说话人聚合后，聚类数最多等于说话人数。
 */

/**
 * 同一说话人的所有段落 embedding 取平均并做 L2 归一化，
 * 每段回填其说话人的聚合向量（无 embedding 的段也能借到同说话人的向量）。
 */
export function aggregateEmbeddingsBySpeaker(
  segments: { speaker: string | null }[],
  embeddings: (number[] | null)[]
): (number[] | null)[] {
  const sums = new Map<string, { sum: number[]; count: number }>();
  for (let i = 0; i < segments.length; i++) {
    const spk = segments[i]?.speaker;
    const emb = embeddings[i];
    if (!spk || !emb || emb.length === 0) continue;
    const entry = sums.get(spk);
    if (!entry) {
      sums.set(spk, { sum: [...emb], count: 1 });
    } else if (entry.sum.length === emb.length) {
      for (let j = 0; j < emb.length; j++) entry.sum[j] += emb[j];
      entry.count++;
    }
  }
  if (sums.size === 0) return embeddings;

  const centroids = new Map<string, number[]>();
  for (const [spk, { sum, count }] of sums) {
    const avg = sum.map((v) => v / count);
    let norm = 0;
    for (const v of avg) norm += v * v;
    norm = Math.sqrt(norm);
    centroids.set(spk, norm > 0 ? avg.map((v) => v / norm) : avg);
  }

  return segments.map((s, i) => {
    if (s.speaker && centroids.has(s.speaker)) {
      return centroids.get(s.speaker)!;
    }
    return embeddings[i] ?? null;
  });
}
