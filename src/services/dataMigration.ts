import { invoke } from "@tauri-apps/api/core";

interface LegacyProject {
  id: string;
  title: string;
  parentId?: string | null;
  isFolder?: boolean;
  sortOrder?: number;
  audioPath?: string | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function migrateFromLocalStorage(): Promise<boolean> {
  // Check if already migrated
  const migrated = await invoke<string | null>("db_get_setting", {
    key: "migrated_from_localstorage",
  });
  if (migrated === "true") return false;

  // Migrate projects data
  const projectsRaw = localStorage.getItem("openmeet-projects");
  if (projectsRaw) {
    try {
      const parsed = JSON.parse(projectsRaw);
      const projects: LegacyProject[] = parsed.state?.projects || [];
      for (const p of projects) {
        await invoke("db_add_project", {
          project: {
            id: p.id,
            title: p.title,
            parent_id: p.parentId || null,
            is_folder: p.isFolder || false,
            sort_order: p.sortOrder || 0,
            audio_path: p.audioPath || null,
            duration_ms: p.durationMs || null,
            created_at: p.createdAt,
            updated_at: p.updatedAt,
          },
        });
      }
    } catch (e) {
      console.error("Failed to migrate projects:", e);
    }
  }

  // Migrate settings
  const settingsRaw = localStorage.getItem("openmeet-settings");
  if (settingsRaw) {
    try {
      const parsed = JSON.parse(settingsRaw);
      await invoke("db_set_setting", {
        key: "settings",
        value: JSON.stringify(parsed.state),
      });
    } catch (e) {
      console.error("Failed to migrate settings:", e);
    }
  }

  // Migrate first-run flag
  const firstRun = localStorage.getItem("openmeet_first_run_done");
  if (firstRun) {
    await invoke("db_set_setting", {
      key: "first_run_done",
      value: firstRun,
    });
  }

  // Migrate language setting
  const lang = localStorage.getItem("openmeet_language");
  if (lang) {
    await invoke("db_set_setting", { key: "language", value: lang });
  }

  // Mark migration complete
  await invoke("db_set_setting", {
    key: "migrated_from_localstorage",
    value: "true",
  });

  return true;
}
