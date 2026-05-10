const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || "Request failed");
    error.details = data.errors || null;
    throw error;
  }

  return data;
}

export const api = {
  login: (payload) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) =>
    request("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  me: (token) => request("/auth/me", { token }),
  dashboard: (token) => request("/dashboard", { token }),
  users: (token) => request("/users", { token }),
  updateProfile: (token, payload) =>
    request("/users/me", { method: "PATCH", token, body: JSON.stringify(payload) }),
  updatePassword: (token, payload) =>
    request("/users/me/password", { method: "PATCH", token, body: JSON.stringify(payload) }),
  projects: (token) => request("/projects", { token }),
  createProject: (token, payload) =>
    request("/projects", { method: "POST", token, body: JSON.stringify(payload) }),
  updateProject: (token, id, payload) =>
    request(`/projects/${id}`, { method: "PUT", token, body: JSON.stringify(payload) }),
  addMember: (token, projectId, userId) =>
    request(`/projects/${projectId}/members`, {
      method: "POST",
      token,
      body: JSON.stringify({ userId })
    }),
  projectMembers: (token, projectId) => request(`/projects/${projectId}/members`, { token }),
  projectTasks: (token, projectId) => request(`/projects/${projectId}/tasks`, { token }),
  createTask: (token, projectId, payload) =>
    request(`/projects/${projectId}/tasks`, {
      method: "POST",
      token,
      body: JSON.stringify(payload)
    }),
  updateTask: (token, taskId, payload) =>
    request(`/tasks/${taskId}`, { method: "PUT", token, body: JSON.stringify(payload) }),
  deleteTask: (token, taskId) =>
    request(`/tasks/${taskId}`, { method: "DELETE", token })
};
