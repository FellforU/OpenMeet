import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  VoiceprintInfo,
  VoiceprintMetadata,
  VoiceprintMatchResult,
} from "../types";

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
  passiveLearn: (id: string, newEmbedding: number[]) => Promise<void>;
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

  passiveLearn: async (id, newEmbedding) => {
    await invoke("voiceprint_passive_learn", { id, newEmbedding });
  },
}));
