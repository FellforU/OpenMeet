import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types";

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;

  loadProjects: () => Promise<void>;
  addProject: (title: string, parentId?: string | null) => Promise<Project>;
  addFolder: (title: string, parentId?: string | null) => Promise<Project>;
  setActiveProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  moveItem: (id: string, targetParentId: string | null) => Promise<void>;
  reorder: (parentId: string | null, orderedIds: string[]) => Promise<void>;
  getItemDepth: (id: string) => number;
  getDescendantIds: (id: string) => string[];
  getMaxSortOrder: (parentId: string | null) => number;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Map TypeScript camelCase to Rust snake_case
function mapToRust(p: Project) {
  return {
    id: p.id,
    title: p.title,
    parent_id: p.parentId,
    is_folder: p.isFolder,
    sort_order: p.sortOrder,
    audio_path: p.audioPath,
    duration_ms: p.durationMs,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// Map Rust snake_case to TypeScript camelCase
function mapFromRust(r: {
  id: string;
  title: string;
  parent_id: string | null;
  is_folder: boolean;
  sort_order: number;
  audio_path: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: r.id,
    title: r.title,
    parentId: r.parent_id,
    isFolder: r.is_folder,
    sortOrder: r.sort_order,
    audioPath: r.audio_path,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,

  loadProjects: async () => {
    const rows = await invoke<
      Array<{
        id: string;
        title: string;
        parent_id: string | null;
        is_folder: boolean;
        sort_order: number;
        audio_path: string | null;
        duration_ms: number | null;
        created_at: string;
        updated_at: string;
      }>
    >("db_get_all_projects");
    const projects = rows.map(mapFromRust);
    set({ projects });
  },

  addProject: async (title: string, parentId: string | null = null) => {
    const maxOrder = get().getMaxSortOrder(parentId);
    const project: Project = {
      id: generateId(),
      title,
      parentId,
      isFolder: false,
      sortOrder: maxOrder + 1,
      audioPath: null,
      durationMs: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await invoke("db_add_project", { project: mapToRust(project) });
    set((state) => ({
      projects: [...state.projects, project],
      activeProjectId: project.id,
    }));
    return project;
  },

  addFolder: async (title: string, parentId: string | null = null) => {
    const maxOrder = get().getMaxSortOrder(parentId);
    const folder: Project = {
      id: generateId(),
      title,
      parentId,
      isFolder: true,
      sortOrder: maxOrder + 1,
      audioPath: null,
      durationMs: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await invoke("db_add_project", { project: mapToRust(folder) });
    set((state) => ({
      projects: [...state.projects, folder],
    }));
    return folder;
  },

  setActiveProject: (id: string) => {
    set({ activeProjectId: id });
    // Lazy-import to avoid circular dependency
    import("./transcriptionStore").then(({ useTranscriptionStore }) => {
      useTranscriptionStore.getState().loadProjectData(id);
    });
  },

  updateProject: async (id: string, updates: Partial<Project>) => {
    // Build rust-compatible update object
    const rustUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) rustUpdates.title = updates.title;
    if (updates.parentId !== undefined) rustUpdates.parent_id = updates.parentId;
    if (updates.audioPath !== undefined) rustUpdates.audio_path = updates.audioPath;
    if (updates.durationMs !== undefined) rustUpdates.duration_ms = updates.durationMs;
    if (updates.sortOrder !== undefined) rustUpdates.sort_order = updates.sortOrder;

    await invoke("db_update_project", { id, updates: rustUpdates });
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id
          ? { ...p, ...updates, updatedAt: new Date().toISOString() }
          : p
      ),
    }));
  },

  deleteProject: async (id: string) => {
    const descendantIds = get().getDescendantIds(id);
    const idsToDelete = new Set([id, ...descendantIds]);
    await invoke("db_delete_project", { id });
    set((state) => ({
      projects: state.projects.filter((p) => !idsToDelete.has(p.id)),
      activeProjectId:
        idsToDelete.has(state.activeProjectId ?? "")
          ? null
          : state.activeProjectId,
    }));
  },

  moveItem: async (id: string, targetParentId: string | null) => {
    const maxOrder = get().getMaxSortOrder(targetParentId);
    await invoke("db_update_project", {
      id,
      updates: {
        parent_id: targetParentId,
        sort_order: maxOrder + 1,
      },
    });
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              parentId: targetParentId,
              sortOrder: maxOrder + 1,
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
  },

  reorder: async (_parentId: string | null, orderedIds: string[]) => {
    await invoke("db_reorder_projects", { orderedIds });
    set((state) => ({
      projects: state.projects.map((p) => {
        const index = orderedIds.indexOf(p.id);
        if (index === -1) return p;
        return { ...p, sortOrder: index, updatedAt: new Date().toISOString() };
      }),
    }));
  },

  getItemDepth: (id: string) => {
    const { projects } = get();
    let depth = 0;
    let current = projects.find((p) => p.id === id);
    while (current?.parentId) {
      depth++;
      current = projects.find((p) => p.id === current!.parentId);
    }
    return depth;
  },

  getDescendantIds: (id: string) => {
    const { projects } = get();
    const result: string[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = projects.filter((p) => p.parentId === currentId);
      for (const child of children) {
        result.push(child.id);
        queue.push(child.id);
      }
    }
    return result;
  },

  getMaxSortOrder: (parentId: string | null) => {
    const { projects } = get();
    const siblings = projects.filter(
      (p) => (p.parentId ?? null) === parentId
    );
    if (siblings.length === 0) return -1;
    return Math.max(...siblings.map((s) => s.sortOrder ?? 0));
  },
}));
