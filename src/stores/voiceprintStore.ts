import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  VoiceprintInfo,
  VoiceprintMetadata,
  VoiceprintMatchResult,
} from "../types";
import { useTranscriptionStore } from "./transcriptionStore";

interface VoiceprintStore {
  voiceprints: VoiceprintInfo[];
  loading: boolean;

  loadVoiceprints: () => Promise<void>;
  createVoiceprint: (name: string) => Promise<VoiceprintInfo>;
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

  createVoiceprint: async (name) => {
    const info = await invoke<VoiceprintInfo>("voiceprint_create", { name });
    set({ voiceprints: [info, ...get().voiceprints] });
    return info;
  },

  updateVoiceprint: async (id, metadata) => {
    await invoke("voiceprint_update", { id, metadata });
    await get().loadVoiceprints();

    // Sync name change to current transcript segments
    if (metadata.name) {
      const tStore = useTranscriptionStore.getState();
      const segments = tStore.segments;
      const needsUpdate = segments.some((s) => s.voiceprintId === id && s.speaker !== metadata.name);
      if (needsUpdate) {
        tStore.setSegments(
          segments.map((s) =>
            s.voiceprintId === id ? { ...s, speaker: metadata.name! } : s
          )
        );
        // Persist updated segments
        const { useProjectStore } = await import("./projectStore");
        const projectId = useProjectStore.getState().activeProjectId;
        if (projectId) {
          tStore.persistSegments(projectId).catch(() => {});
        }
      }
    }
  },

  deleteVoiceprint: async (id) => {
    await invoke("voiceprint_delete", { id });
    set({ voiceprints: get().voiceprints.filter((v) => v.id !== id) });

    // Clear voiceprintId from current transcript segments
    const tStore = useTranscriptionStore.getState();
    const segments = tStore.segments;
    const needsUpdate = segments.some((s) => s.voiceprintId === id);
    if (needsUpdate) {
      tStore.setSegments(
        segments.map((s) =>
          s.voiceprintId === id ? { ...s, voiceprintId: undefined } : s
        )
      );
      const { useProjectStore } = await import("./projectStore");
      const projectId = useProjectStore.getState().activeProjectId;
      if (projectId) {
        tStore.persistSegments(projectId).catch(() => {});
      }
    }
  },

  mergeVoiceprints: async (sourceId, targetId) => {
    await invoke("voiceprint_merge", { sourceId, targetId });
    await get().loadVoiceprints();

    // Update segments: reassign source voiceprint to target
    const targetVp = get().voiceprints.find((v) => v.id === targetId);
    const tStore = useTranscriptionStore.getState();
    const segments = tStore.segments;
    const needsUpdate = segments.some((s) => s.voiceprintId === sourceId);
    if (needsUpdate) {
      tStore.setSegments(
        segments.map((s) =>
          s.voiceprintId === sourceId
            ? { ...s, voiceprintId: targetId, speaker: targetVp?.name ?? s.speaker }
            : s
        )
      );
      const { useProjectStore } = await import("./projectStore");
      const projectId = useProjectStore.getState().activeProjectId;
      if (projectId) {
        tStore.persistSegments(projectId).catch(() => {});
      }
    }
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
