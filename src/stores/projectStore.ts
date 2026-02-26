import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project } from "../types";

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;

  addProject: (title: string, parentId?: string | null) => Project;
  addFolder: (title: string, parentId?: string | null) => Project;
  setActiveProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  moveItem: (id: string, targetParentId: string | null) => void;
  reorder: (parentId: string | null, orderedIds: string[]) => void;
  getItemDepth: (id: string) => number;
  getDescendantIds: (id: string) => string[];
  getMaxSortOrder: (parentId: string | null) => number;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      addProject: (title: string, parentId: string | null = null) => {
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
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: project.id,
        }));
        return project;
      },

      addFolder: (title: string, parentId: string | null = null) => {
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
        set((state) => ({
          projects: [...state.projects, folder],
        }));
        return folder;
      },

      setActiveProject: (id: string) => {
        set({ activeProjectId: id });
      },

      updateProject: (id: string, updates: Partial<Project>) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? { ...p, ...updates, updatedAt: new Date().toISOString() }
              : p
          ),
        }));
      },

      deleteProject: (id: string) => {
        const descendantIds = get().getDescendantIds(id);
        const idsToDelete = new Set([id, ...descendantIds]);
        set((state) => ({
          projects: state.projects.filter((p) => !idsToDelete.has(p.id)),
          activeProjectId:
            idsToDelete.has(state.activeProjectId ?? "")
              ? null
              : state.activeProjectId,
        }));
      },

      moveItem: (id: string, targetParentId: string | null) => {
        const maxOrder = get().getMaxSortOrder(targetParentId);
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

      reorder: (_parentId: string | null, orderedIds: string[]) => {
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
    }),
    {
      name: "openmeet-projects",
      // Migrate old data without sortOrder
      migrate: (persisted: unknown, _version: number) => {
        const state = persisted as { projects?: Project[] };
        if (state.projects) {
          state.projects = state.projects.map((p, i) => ({
            ...p,
            sortOrder: p.sortOrder ?? i,
          }));
        }
        return state as ProjectStore;
      },
      version: 1,
    }
  )
);
