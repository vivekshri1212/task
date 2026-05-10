const BASE_URL = import.meta.env.VITE_BASE_URL || "http://localhost:4000";
const API_URL = `${BASE_URL.replace(/\/$/, "")}/api`;
const DEBUG_API = import.meta.env.DEV || import.meta.env.VITE_DEBUG_API === "true";

if (DEBUG_API) {
  console.info("[api] configured", { BASE_URL, API_URL });
}

async function request(path, options = {}) {
  const url = `${API_URL}${path}`;
  const method = options.method || "GET";

  if (DEBUG_API) {
    console.info(`[api] request ${method} ${url}`);
  }

  let response;

  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      ...options
    });
  } catch (error) {
    console.error(`[api] network error ${method} ${url}`, error);
    throw error;
  }

  if (DEBUG_API) {
    console.info(`[api] response ${method} ${url} -> ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  let data;

  try {
    data = await response.json();
  } catch {
    data = { message: "Server returned a non-JSON response." };
  }

  if (!response.ok) {
    const error = new Error(data.message || "Request failed");
    error.details = data.errors || null;
    console.error(`[api] request failed ${method} ${url}`, {
      status: response.status,
      data
    });
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
