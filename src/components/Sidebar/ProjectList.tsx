import { ProjectItem } from "./ProjectItem";
import { useProjectStore } from "../../stores/projectStore";

export function ProjectList() {
  const { projects, activeProjectId, setActiveProject, deleteProject } =
    useProjectStore();

  if (projects.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#999", fontSize: 12 }}>
        No projects yet
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 8px" }}>
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
