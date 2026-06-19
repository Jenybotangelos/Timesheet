import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

interface Project {
  id: number;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
}

export default function Projects({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchProjects() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/projects`);
      const data = await res.json();
      setProjects(data);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  function openNewForm() {
    setEditingProject(null);
    setName("");
    setDescription("");
    setShowForm(true);
  }

  function openEditForm(project: Project) {
    setEditingProject(project);
    setName(project.name);
    setDescription(project.description);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingProject(null);
    setName("");
    setDescription("");
  }

  async function handleSave() {
    if (!name.trim()) {
      alert("Project name is required");
      return;
    }
    setSaving(true);
    try {
      if (editingProject) {
        // Update
        const res = await fetch(`${API_BASE}/projects/${editingProject.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, name, description, is_active: editingProject.is_active }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert("Error: " + err.error);
          return;
        }
      } else {
        // Create
        const res = await fetch(`${API_BASE}/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, name, description }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert("Error: " + err.error);
          return;
        }
      }
      cancelForm();
      await fetchProjects();
    } catch (err) {
      console.error("Failed to save project:", err);
      alert("Failed to save project");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(project: Project) {
    try {
      const res = await fetch(`${API_BASE}/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          name: project.name,
          description: project.description,
          is_active: !project.is_active,
        }),
      });
      if (res.ok) {
        await fetchProjects();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to toggle project:", err);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this project?")) return;
    try {
      const res = await fetch(`${API_BASE}/projects/${id}?email=${encodeURIComponent(userEmail)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchProjects();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center">
        <p className="text-white/60">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-[#4fc3f7] hover:text-white transition-colors">← Back</button>
          <h1 className="text-xl font-semibold text-white">Projects</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30">Admin</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Add Project Button */}
        <div className="flex justify-end mb-6">
          <button
            onClick={openNewForm}
            className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium transition-all shadow-md"
          >
            + Add Project
          </button>
        </div>

        {/* New/Edit Project Form */}
        {showForm && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-6 mb-6 shadow-lg">
            <h3 className="text-white font-semibold mb-4">
              {editingProject ? "Edit Project" : "New Project"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter project name"
                  className="w-full border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter project description"
                  rows={3}
                  className="w-full border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium transition-all shadow-md disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingProject ? "Update Project" : "Create Project"}
                </button>
                <button
                  onClick={cancelForm}
                  className="px-4 py-2 bg-white/5 border border-white/20 text-white/60 rounded-lg hover:bg-white/10 text-sm transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Projects List */}
        {projects.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">No projects yet. Click "+ Add Project" to create one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-5 shadow-xl transition-all ${
                  !project.is_active ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold text-lg">{project.name}</h3>
                      {project.is_active ? (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium border border-green-500/30">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-medium border border-red-500/30">
                          Inactive
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-white/60 text-sm mb-2">{project.description}</p>
                    )}
                    <p className="text-white/30 text-xs">
                      Created by {project.created_by} · {new Date(project.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEditForm(project)}
                      className="px-3 py-1.5 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 text-xs font-medium transition-all"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(project)}
                      className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-all ${
                        project.is_active
                          ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20"
                          : "bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20"
                      }`}
                    >
                      {project.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 text-xs font-medium transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
