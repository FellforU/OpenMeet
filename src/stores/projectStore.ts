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
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,

      addProject: (title: string, parentId: string | null = null) => {
        const project: Project = {
          id: generateId(),
          title,
          parentId,
          isFolder: false,
          audioPath: null,
          durationMs: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          projects: [project, ...state.projects],
          activeProjectId: project.id,
        }));
        return project;
      },

      addFolder: (title: string, parentId: string | null = null) => {
        const folder: Project = {
          id: generateId(),
          title,
          parentId,
          isFolder: true,
          audioPath: null,
          durationMs: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          projects: [folder, ...state.projects],
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
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          activeProjectId:
            state.activeProjectId === id ? null : state.activeProjectId,
        }));
      },
    }),
    { name: "openmeet-projects" }
  )
);
