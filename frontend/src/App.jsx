import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "./api.js";

const PROJECT_TEMPLATE = {
  name: "",
  description: "",
  status: "planning",
  priority: "medium",
  dueDate: ""
};

const TASK_TEMPLATE = {
  title: "",
  description: "",
  status: "todo",
  priority: "medium",
  dueDate: "",
  assignedTo: ""
};

const PROFILE_TEMPLATE = {
  name: "",
  email: ""
};

const PASSWORD_TEMPLATE = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
};

const TASK_STATUS_OPTIONS = ["todo", "in_progress", "review", "done"];
const PROJECT_STATUS_OPTIONS = ["planning", "active", "completed", "on_hold"];
const PROJECT_PRIORITY_OPTIONS = ["low", "medium", "high"];
const TASK_PRIORITY_OPTIONS = ["low", "medium", "high"];

const STATUS_COLORS = {
  todo: "#f3b53f",
  in_progress: "#4a7dff",
  review: "#7a5af8",
  done: "#28a266",
  planning: "#98a2b3",
  active: "#4a7dff",
  completed: "#28a266",
  on_hold: "#f79009",
  low: "#28a266",
  medium: "#f79009",
  high: "#ef4444"
};

const VIEW_ITEMS = [
  { id: "dashboard", label: "Dashboard", short: "DB" },
  { id: "projects", label: "Projects", short: "PR" },
  { id: "tasks", label: "Tasks", short: "TK" },
  { id: "profile", label: "Profile", short: "PF" }
];

function App() {
  const navigate = useNavigate();
  const [token, setToken] = useState(() => localStorage.getItem("ethara_token"));
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }

    api.me(token)
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem("ethara_token");
        setToken(null);
      })
      .finally(() => setBooting(false));
  }, [token]);

  function handleAuthSuccess(data) {
    localStorage.setItem("ethara_token", data.token);
    setToken(data.token);
    setUser(data.user);
    navigate("/app");
  }

  function handleSessionRefresh(data) {
    if (data.token) {
      localStorage.setItem("ethara_token", data.token);
      setToken(data.token);
    }

    if (data.user) {
      setUser(data.user);
    }
  }

  function handleLogout() {
    localStorage.removeItem("ethara_token");
    setToken(null);
    setUser(null);
    navigate("/login");
  }

  if (booting) {
    return <FullscreenState title="Loading workspace" message="Restoring your dashboard and access controls." />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={token && user ? <Navigate to="/app" replace /> : <AuthPage onAuthSuccess={handleAuthSuccess} />}
      />
      <Route
        path="/app"
        element={
          token && user ? (
            <Workspace
              token={token}
              user={user}
              onLogout={handleLogout}
              onSessionRefresh={handleSessionRefresh}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={token ? "/app" : "/login"} replace />} />
    </Routes>
  );
}

function AuthPage({ onAuthSuccess }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setFieldErrors({});

    try {
      const response =
        mode === "login"
          ? await api.login({ email: form.email, password: form.password })
          : await api.register(form);

      onAuthSuccess(response);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.details || {});
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page simple">
      <div className="auth-panel single">
        <div className="auth-card compact">
          <div className="auth-card-head">
            <p className="eyebrow dark">Task Manager</p>
            <h2>{mode === "login" ? "Login" : "Sign Up"}</h2>
            <p>{mode === "login" ? "Access your workspace" : "Create your account to continue"}</p>
          </div>

          <div className="segment">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
              Login
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">
              Sign Up
            </button>
          </div>

          <form className="stack" onSubmit={handleSubmit}>
            {mode === "register" ? (
              <Field
                label="Full name"
                value={form.name}
                onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                error={fieldErrors.name?.[0]}
              />
            ) : null}

            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
              error={fieldErrors.email?.[0]}
            />

            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={(value) => setForm((current) => ({ ...current, password: value }))}
              error={fieldErrors.password?.[0]}
            />

            {error ? <p className="error-banner">{error}</p> : null}

            <button className="primary-button" disabled={loading}>
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Workspace({ token, user, onLogout, onSessionRefresh }) {
  const [activeView, setActiveView] = useState("dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [projectMembers, setProjectMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [projectMode, setProjectMode] = useState("edit");
  const [projectForm, setProjectForm] = useState(PROJECT_TEMPLATE);
  const [profileForm, setProfileForm] = useState({
    ...PROFILE_TEMPLATE,
    name: user.name,
    email: user.email
  });
  const [passwordForm, setPasswordForm] = useState(PASSWORD_TEMPLATE);
  const [taskDraft, setTaskDraft] = useState(TASK_TEMPLATE);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [memberUserId, setMemberUserId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  const dashboardRecentTasks = useMemo(() => tasks.slice(0, 5), [tasks]);
  const completionRate = selectedProject?.taskCount
    ? Math.round((selectedProject.completedTaskCount / selectedProject.taskCount) * 100)
    : 0;

  useEffect(() => {
    setProfileForm({ name: user.name, email: user.email });
  }, [user.name, user.email]);

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      setProjectForm({
        name: selectedProject.name,
        description: selectedProject.description,
        status: selectedProject.status,
        priority: selectedProject.priority,
        dueDate: selectedProject.dueDate || ""
      });
      setProjectMode("edit");
    } else {
      setProjectForm(PROJECT_TEMPLATE);
    }
  }, [selectedProjectId, projects]);

  async function loadWorkspace(preferredProjectId) {
    setLoading(true);
    setError("");

    try {
      const [dashboardData, projectsData, usersData] = await Promise.all([
        api.dashboard(token),
        api.projects(token),
        api.users(token)
      ]);

      setDashboard(dashboardData);
      setProjects(projectsData.projects);
      setUsers(usersData.users);

      const nextProjectId = preferredProjectId || selectedProjectId || projectsData.projects[0]?.id || null;
      setSelectedProjectId(nextProjectId);

      if (nextProjectId) {
        await loadProjectDetails(nextProjectId);
      } else {
        setTasks([]);
        setProjectMembers([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadProjectDetails(projectId) {
    setDetailLoading(true);

    try {
      const [taskData, memberData] = await Promise.all([
        api.projectTasks(token, projectId),
        api.projectMembers(token, projectId)
      ]);

      setTasks(taskData.tasks);
      setProjectMembers(memberData.members);
      setSelectedProjectId(projectId);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function resetFeedback() {
    setError("");
    setSuccess("");
  }

  async function handleProjectSubmit(event) {
    event.preventDefault();
    resetFeedback();

    try {
      const payload = {
        ...projectForm,
        dueDate: projectForm.dueDate || null
      };

      if (projectMode === "edit" && selectedProject) {
        await api.updateProject(token, selectedProject.id, payload);
        setSuccess("Project updated successfully.");
        await loadWorkspace(selectedProject.id);
      } else {
        const response = await api.createProject(token, payload);
        setSuccess("Project created successfully.");
        setProjectForm(PROJECT_TEMPLATE);
        setProjectMode("edit");
        await loadWorkspace(response.project.id);
        setActiveView("projects");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddMember(event) {
    event.preventDefault();
    if (!selectedProjectId || !memberUserId) return;
    resetFeedback();

    try {
      await api.addMember(token, selectedProjectId, Number(memberUserId));
      setMemberUserId("");
      setSuccess("Project member added successfully.");
      await loadProjectDetails(selectedProjectId);
      await loadWorkspace(selectedProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTaskSubmit(event) {
    event.preventDefault();
    if (!selectedProjectId) return;
    resetFeedback();

    try {
      await api.createTask(token, selectedProjectId, {
        title: taskDraft.title,
        description: taskDraft.description,
        status: taskDraft.status,
        priority: taskDraft.priority,
        dueDate: taskDraft.dueDate || null,
        assignedTo: taskDraft.assignedTo ? Number(taskDraft.assignedTo) : null
      });

      setTaskDraft(TASK_TEMPLATE);
      setTaskModalOpen(false);
      setSuccess("Task created successfully.");
      await loadWorkspace(selectedProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTaskStatus(task, status) {
    resetFeedback();

    try {
      await api.updateTask(token, task.id, {
        title: task.title,
        description: task.description,
        status,
        priority: task.priority,
        dueDate: task.dueDate,
        assignedTo: task.assignedTo
      });

      setSuccess("Task status updated.");
      await loadWorkspace(selectedProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteTask(taskId) {
    resetFeedback();

    try {
      await api.deleteTask(token, taskId);
      setSuccess("Task deleted successfully.");
      await loadWorkspace(selectedProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    resetFeedback();

    try {
      const response = await api.updateProfile(token, profileForm);
      onSessionRefresh(response);
      setSuccess("Profile updated successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    resetFeedback();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirm password must match.");
      return;
    }

    try {
      const response = await api.updatePassword(token, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setSuccess(response.message);
      setPasswordForm(PASSWORD_TEMPLATE);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <FullscreenState title="Syncing data" message="Loading projects, tasks, and dashboard insights." />;
  }

  return (
    <div className="workspace-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark">TM</div>
          <div>
            <strong>Task Manager</strong>
            <span>Assessment build</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-button ${activeView === item.id ? "active" : ""}`}
              onClick={() => {
                setActiveView(item.id);
                setSidebarOpen(false);
              }}
            >
              <span className="nav-icon">{item.short}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-mini">
            <div className="avatar">{getInitials(user.name)}</div>
            <div>
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
          </div>
          <button className="logout-button" onClick={onLogout} type="button">Logout</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar alt">
          <div className="topbar-left">
            <button className="menu-button" type="button" onClick={() => setSidebarOpen((current) => !current)}>
              Menu
            </button>
            <div>
              <h2>{VIEW_ITEMS.find((item) => item.id === activeView)?.label}</h2>
              <p className="topbar-subtitle">
                {activeView === "dashboard" ? `Welcome back, ${user.name}` : selectedProject?.name || "Manage your workspace"}
              </p>
            </div>
          </div>

          <div className="topbar-actions">
            <span className={`role-pill ${user.role}`}>{user.role}</span>
            {activeView !== "profile" ? (
              <button
                className="primary-button small"
                type="button"
                onClick={() => {
                  setTaskModalOpen(true);
                  setActiveView("tasks");
                }}
                disabled={!selectedProjectId}
              >
                Add New Task
              </button>
            ) : null}
          </div>
        </header>

        {error ? <p className="error-banner">{error}</p> : null}
        {success ? <p className="success-banner">{success}</p> : null}

        {activeView === "dashboard" ? (
          <DashboardView
            dashboard={dashboard}
            tasks={dashboardRecentTasks}
            projects={projects}
            selectedProject={selectedProject}
            onSelectProject={loadProjectDetails}
          />
        ) : null}

        {activeView === "projects" ? (
          <ProjectsView
            user={user}
            projects={projects}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            projectMembers={projectMembers}
            projectMode={projectMode}
            projectForm={projectForm}
            memberUserId={memberUserId}
            users={users}
            completionRate={completionRate}
            detailLoading={detailLoading}
            onSelectProject={loadProjectDetails}
            onProjectModeChange={setProjectMode}
            onProjectFormChange={setProjectForm}
            onMemberUserIdChange={setMemberUserId}
            onProjectSubmit={handleProjectSubmit}
            onAddMember={handleAddMember}
            onOpenTaskModal={() => setTaskModalOpen(true)}
          />
        ) : null}

        {activeView === "tasks" ? (
          <TasksView
            user={user}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            projects={projects}
            tasks={tasks}
            detailLoading={detailLoading}
            onSelectProject={loadProjectDetails}
            onTaskStatus={handleTaskStatus}
            onDeleteTask={handleDeleteTask}
            onOpenTaskModal={() => setTaskModalOpen(true)}
          />
        ) : null}

        {activeView === "profile" ? (
          <ProfileView
            user={user}
            profileForm={profileForm}
            passwordForm={passwordForm}
            onProfileFormChange={setProfileForm}
            onPasswordFormChange={setPasswordForm}
            onProfileSubmit={handleProfileSubmit}
            onPasswordSubmit={handlePasswordSubmit}
          />
        ) : null}
      </main>

      {taskModalOpen ? (
        <TaskModal
          open={taskModalOpen}
          selectedProject={selectedProject}
          projectMembers={projectMembers}
          taskDraft={taskDraft}
          onClose={() => setTaskModalOpen(false)}
          onChange={setTaskDraft}
          onSubmit={handleTaskSubmit}
        />
      ) : null}
    </div>
  );
}

function DashboardView({ dashboard, tasks, projects, selectedProject, onSelectProject }) {
  return (
    <>
      <section className="summary-grid">
        <SummaryCard label="Total Projects" value={dashboard.summary.totalProjects} delta="+1 this week" />
        <SummaryCard label="Total Tasks" value={dashboard.summary.totalTasks} delta="+5 this week" />
        <SummaryCard label="Completed Tasks" value={dashboard.summary.completedTasks} delta="+2 this week" />
        <SummaryCard label="Pending Tasks" value={dashboard.summary.totalTasks - dashboard.summary.completedTasks} delta="-1 this week" />
      </section>

      <section className="layout-grid dashboard-grid">
        <Panel title="Tasks Overview" subtitle="Status distribution across your current workload">
          <div className="chart-card">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={dashboard.charts.statusBreakdown} dataKey="value" nameKey="label" innerRadius={60} outerRadius={90}>
                  {dashboard.charts.statusBreakdown.map((entry) => (
                    <Cell key={entry.label} fill={STATUS_COLORS[entry.label]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Recent Tasks" subtitle={selectedProject ? `Live from ${selectedProject.name}` : "Recent delivery activity"}>
          <div className="task-list simple">
            {tasks.length ? tasks.map((task) => <RecentTaskRow key={task.id} task={task} />) : <EmptyState title="No recent tasks" message="Select a project or create a task to populate this section." />}
          </div>
        </Panel>
      </section>

      <section className="layout-grid dashboard-grid secondary">
        <Panel title="Priority Mix" subtitle="Where urgency is concentrated">
          <div className="chart-card">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dashboard.charts.priorityBreakdown}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {dashboard.charts.priorityBreakdown.map((entry) => (
                    <Cell key={entry.label} fill={STATUS_COLORS[entry.label]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Projects" subtitle="Quick access to your active workspaces">
          <div className="project-list compact-list">
            {projects.length ? (
              projects.map((project) => (
                <button key={project.id} className="project-line" type="button" onClick={() => onSelectProject(project.id)}>
                  <div>
                    <strong>{project.name}</strong>
                    <span>{project.taskCount} tasks</span>
                  </div>
                  <span className={`status-chip ${project.status}`}>{prettyLabel(project.status)}</span>
                </button>
              ))
            ) : (
              <EmptyState title="No projects yet" message="Create your first project to unlock the dashboard." />
            )}
          </div>
        </Panel>
      </section>
    </>
  );
}

function ProjectsView({
  user,
  projects,
  selectedProject,
  selectedProjectId,
  projectMembers,
  projectMode,
  projectForm,
  memberUserId,
  users,
  completionRate,
  detailLoading,
  onSelectProject,
  onProjectModeChange,
  onProjectFormChange,
  onMemberUserIdChange,
  onProjectSubmit,
  onAddMember,
  onOpenTaskModal
}) {
  return (
    <section className="layout-grid projects-grid">
      <Panel title="Projects" subtitle="Browse or switch the current delivery workspace">
        <div className="project-list">
          {projects.length ? (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`project-card refined ${project.id === selectedProjectId ? "selected" : ""}`}
                onClick={() => onSelectProject(project.id)}
              >
                <div className="project-row">
                  <h3>{project.name}</h3>
                  <span className={`status-chip ${project.status}`}>{prettyLabel(project.status)}</span>
                </div>
                <p>{project.description}</p>
                <div className="project-meta">
                  <span>{project.memberCount} members</span>
                  <span>{project.taskCount} tasks</span>
                  <span>{project.priority} priority</span>
                </div>
              </button>
            ))
          ) : (
            <EmptyState title="No projects yet" message="Create a project to start managing tasks and team members." />
          )}
        </div>
      </Panel>

      <div className="project-detail-stack">
        <Panel title="Project Details" subtitle={selectedProject ? selectedProject.description : "Select a project to inspect details"}>
          {detailLoading ? (
            <InlineState message="Loading project details..." />
          ) : selectedProject ? (
            <div className="stack">
              <div className="project-highlight">
                <div>
                  <strong>{selectedProject.name}</strong>
                  <span>Deadline: {formatDate(selectedProject.dueDate)}</span>
                </div>
                <button className="primary-button small" type="button" onClick={onOpenTaskModal}>Add Task</button>
              </div>

              <div className="avatar-row">
                {projectMembers.map((member) => (
                  <div key={member.id} className="avatar avatar-small" title={member.name}>
                    {getInitials(member.name)}
                  </div>
                ))}
              </div>

              <div className="progress-panel">
                <div className="project-meta">
                  <span>Completion</span>
                  <span>{completionRate}%</span>
                </div>
                <div className="progress-bar">
                  <span style={{ width: `${completionRate}%` }} />
                </div>
              </div>

              <div className="tile-grid">
                <MetricTile label="Status" value={prettyLabel(selectedProject.status)} />
                <MetricTile label="Priority" value={prettyLabel(selectedProject.priority)} />
                <MetricTile label="Owner" value={selectedProject.ownerName} />
                <MetricTile label="Tasks" value={selectedProject.taskCount} />
              </div>
            </div>
          ) : (
            <EmptyState title="Pick a project" message="Project overview, members, and task actions will appear here." />
          )}
        </Panel>

        {user.role === "admin" ? (
          <Panel title="Project Settings" subtitle="Create a new project or update the selected one">
            <form className="stack" onSubmit={onProjectSubmit}>
              <div className="segmented-inline">
                <button
                  type="button"
                  className={projectMode === "edit" ? "mini-button active" : "mini-button"}
                  onClick={() => onProjectModeChange("edit")}
                  disabled={!selectedProject}
                >
                  Edit Selected
                </button>
                <button
                  type="button"
                  className={projectMode === "create" ? "mini-button active" : "mini-button"}
                  onClick={() => {
                    onProjectModeChange("create");
                    onProjectFormChange(PROJECT_TEMPLATE);
                  }}
                >
                  Create New
                </button>
              </div>

              <Field label="Project name" value={projectForm.name} onChange={(value) => onProjectFormChange((current) => ({ ...current, name: value }))} />
              <Field label="Description" multiline value={projectForm.description} onChange={(value) => onProjectFormChange((current) => ({ ...current, description: value }))} />

              <div className="split">
                <SelectField
                  label="Status"
                  value={projectForm.status}
                  onChange={(value) => onProjectFormChange((current) => ({ ...current, status: value }))}
                  options={PROJECT_STATUS_OPTIONS}
                />
                <SelectField
                  label="Priority"
                  value={projectForm.priority}
                  onChange={(value) => onProjectFormChange((current) => ({ ...current, priority: value }))}
                  options={PROJECT_PRIORITY_OPTIONS}
                />
              </div>

              <Field
                label="Due date"
                type="date"
                value={projectForm.dueDate}
                onChange={(value) => onProjectFormChange((current) => ({ ...current, dueDate: value }))}
              />

              <button className="primary-button" type="submit">
                {projectMode === "edit" ? "Update Project" : "Create Project"}
              </button>
            </form>
          </Panel>
        ) : null}

        <Panel title="Team Access" subtitle="Manage project membership and visibility">
          {user.role === "admin" ? (
            <form className="stack" onSubmit={onAddMember}>
              <SelectField
                label="Select member"
                value={memberUserId}
                onChange={onMemberUserIdChange}
                options={users.filter((member) => member.role === "member").map((member) => member.id)}
                renderLabel={(value) => users.find((member) => member.id === Number(value))?.name || "Select member"}
                includeBlank
              />
              <button className="primary-button" type="submit" disabled={!selectedProjectId || !memberUserId}>
                Add Member
              </button>
            </form>
          ) : (
            <div className="stack">
              <div className="member-card">
                <strong>Project permissions</strong>
                <span>You can view shared projects and update tasks assigned to you.</span>
              </div>
              <div className="member-card">
                <strong>Admin-only actions</strong>
                <span>Project creation, membership changes, and task deletion stay restricted.</span>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </section>
  );
}

function TasksView({ user, selectedProject, selectedProjectId, projects, tasks, detailLoading, onSelectProject, onTaskStatus, onDeleteTask, onOpenTaskModal }) {
  return (
    <section className="layout-grid tasks-grid">
      <Panel title="Project Switcher" subtitle="Choose the project whose tasks you want to manage">
        <div className="project-list compact-list">
          {projects.map((project) => (
            <button key={project.id} className="project-line" type="button" onClick={() => onSelectProject(project.id)}>
              <div>
                <strong>{project.name}</strong>
                <span>{project.taskCount} tasks</span>
              </div>
              <span className={`status-chip ${project.id === selectedProjectId ? "active" : project.status}`}>
                {project.id === selectedProjectId ? "Selected" : prettyLabel(project.status)}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={selectedProject ? `${selectedProject.name} Tasks` : "Tasks"} subtitle={selectedProject ? "Track and update progress by task" : "Select a project to view task details"}>
        <div className="panel-toolbar">
          <span>{tasks.length} tasks</span>
          <button className="primary-button small" type="button" disabled={!selectedProjectId} onClick={onOpenTaskModal}>
            Add Task
          </button>
        </div>

        {detailLoading ? (
          <InlineState message="Loading task list..." />
        ) : tasks.length ? (
          <div className="task-list">
            {tasks.map((task) => (
              <article className="task-card task-card-wide" key={task.id}>
                <div className="task-card-top">
                  <div>
                    <h3>{task.title}</h3>
                    <p>{task.description}</p>
                  </div>
                  <span className={`status-chip ${task.status}`}>{prettyLabel(task.status)}</span>
                </div>

                <div className="task-meta">
                  <span className={`priority-chip ${task.priority}`}>{prettyLabel(task.priority)}</span>
                  <span>{task.assignedToName || "Unassigned"}</span>
                  <span>{formatDate(task.dueDate)}</span>
                </div>

                <div className="task-actions">
                  {TASK_STATUS_OPTIONS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={task.status === status ? "mini-button active" : "mini-button"}
                      onClick={() => onTaskStatus(task, status)}
                    >
                      {prettyLabel(status)}
                    </button>
                  ))}
                  {user.role === "admin" ? (
                    <button className="mini-button danger" type="button" onClick={() => onDeleteTask(task.id)}>
                      Delete
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No tasks available" message="Use the Add Task action to create the first task for this project." />
        )}
      </Panel>
    </section>
  );
}

function ProfileView({ user, profileForm, passwordForm, onProfileFormChange, onPasswordFormChange, onProfileSubmit, onPasswordSubmit }) {
  return (
    <section className="layout-grid profile-grid">
      <Panel title="Profile Settings" subtitle="Manage your personal information and account security">
        <div className="profile-card">
          <div className="avatar avatar-large">{getInitials(user.name)}</div>
          <h3>{user.name}</h3>
          <p>{user.email}</p>
          <span className={`role-pill ${user.role}`}>{user.role}</span>
        </div>
      </Panel>

      <Panel title="Profile Information" subtitle="Update your name and email address">
        <form className="stack" onSubmit={onProfileSubmit}>
          <Field
            label="Full Name"
            value={profileForm.name}
            onChange={(value) => onProfileFormChange((current) => ({ ...current, name: value }))}
          />
          <Field
            label="Email"
            type="email"
            value={profileForm.email}
            onChange={(value) => onProfileFormChange((current) => ({ ...current, email: value }))}
          />
          <button className="primary-button" type="submit">Update Profile</button>
        </form>
      </Panel>

      <Panel title="Change Password" subtitle="Strengthen your account with a new secure password">
        <form className="stack" onSubmit={onPasswordSubmit}>
          <Field
            label="Current Password"
            type="password"
            value={passwordForm.currentPassword}
            onChange={(value) => onPasswordFormChange((current) => ({ ...current, currentPassword: value }))}
          />
          <Field
            label="New Password"
            type="password"
            value={passwordForm.newPassword}
            onChange={(value) => onPasswordFormChange((current) => ({ ...current, newPassword: value }))}
          />
          <Field
            label="Confirm Password"
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(value) => onPasswordFormChange((current) => ({ ...current, confirmPassword: value }))}
          />
          <button className="primary-button" type="submit">Update Password</button>
        </form>
      </Panel>
    </section>
  );
}

function TaskModal({ open, selectedProject, projectMembers, taskDraft, onClose, onChange, onSubmit }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Add New Task</h3>
            <p>{selectedProject ? selectedProject.name : "Select a project first"}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <Field label="Title" value={taskDraft.title} onChange={(value) => onChange((current) => ({ ...current, title: value }))} />
          <Field label="Description" multiline value={taskDraft.description} onChange={(value) => onChange((current) => ({ ...current, description: value }))} />

          <div className="split">
            <SelectField
              label="Status"
              value={taskDraft.status}
              onChange={(value) => onChange((current) => ({ ...current, status: value }))}
              options={TASK_STATUS_OPTIONS}
            />
            <SelectField
              label="Priority"
              value={taskDraft.priority}
              onChange={(value) => onChange((current) => ({ ...current, priority: value }))}
              options={TASK_PRIORITY_OPTIONS}
            />
          </div>

          <div className="split">
            <Field
              label="Due Date"
              type="date"
              value={taskDraft.dueDate}
              onChange={(value) => onChange((current) => ({ ...current, dueDate: value }))}
            />
            <SelectField
              label="Assign To"
              value={taskDraft.assignedTo}
              onChange={(value) => onChange((current) => ({ ...current, assignedTo: value }))}
              options={projectMembers.map((member) => member.id)}
              renderLabel={(value) => projectMembers.find((member) => member.id === Number(value))?.name || "Select member"}
              includeBlank
            />
          </div>

          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">Create Task</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SummaryCard({ label, value, delta }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{delta}</small>
    </article>
  );
}

function MetricTile({ label, value }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RecentTaskRow({ task }) {
  return (
    <article className="task-row">
      <div className="task-row-main">
        <strong>{task.title}</strong>
        <span>{task.description}</span>
      </div>
      <span className={`status-chip ${task.status}`}>{prettyLabel(task.status)}</span>
    </article>
  );
}

function Field({ label, value, onChange, type = "text", multiline = false, error }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows="4" />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

function SelectField({ label, value, onChange, options, renderLabel, includeBlank = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {includeBlank ? <option value="">Select</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {renderLabel ? renderLabel(option) : prettyLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function InlineState({ message }) {
  return <div className="inline-state">{message}</div>;
}

function EmptyState({ title, message }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function FullscreenState({ title, message }) {
  return (
    <div className="fullscreen-state">
      <div className="fullscreen-card">
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  );
}

function prettyLabel(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function getInitials(name) {
  return String(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default App;
