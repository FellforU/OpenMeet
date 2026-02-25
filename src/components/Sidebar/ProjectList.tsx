import { useTranslation } from "react-i18next";
import { ProjectItem } from "./ProjectItem";
import { useProjectStore } from "../../stores/projectStore";

export function ProjectList() {
  const { t } = useTranslation();
  const { projects, activeProjectId, setActiveProject, deleteProject } =
    useProjectStore();

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        {t("sidebar.noProjects")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1">
      {projects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          isActive={project.id === activeProjectId}
          onClick={() => setActiveProject(project.id)}
          onDelete={() => deleteProject(project.id)}
        />
      ))}
    </div>
  );
}
