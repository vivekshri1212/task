import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import db from "./db.js";
import { requireAuth, requireRole, signToken } from "./auth.js";
import {
  loginSchema,
  passwordSchema,
  profileSchema,
  projectSchema,
  registerSchema,
  taskSchema
} from "./validators.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

function formatUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at
  };
}

function formatProject(project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    dueDate: project.due_date,
    ownerId: project.owner_id,
    ownerName: project.owner_name,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    memberCount: project.member_count,
    taskCount: project.task_count,
    completedTaskCount: project.completed_task_count
  };
}

function formatTask(task) {
  return {
    id: task.id,
    projectId: task.project_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedTo: task.assigned_to,
    assignedToName: task.assignee_name,
    dueDate: task.due_date,
    createdBy: task.created_by,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at
  };
}

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Please correct the highlighted fields.",
      errors: result.error.flatten().fieldErrors
    });
    return null;
  }

  return result.data;
}

function getAccessibleProject(projectId, user) {
  if (user.role === "admin") {
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  }

  return db.prepare(`
    SELECT p.*
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE p.id = ? AND pm.user_id = ?
  `).get(projectId, user.id);
}

function ensureProjectMembership(projectId, assignedTo) {
  if (!assignedTo) {
    return true;
  }

  const membership = db
    .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, assignedTo);

  return Boolean(membership);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", (req, res) => {
  const data = parseBody(registerSchema, req, res);
  if (!data) return;

  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(data.email);
  if (existingUser) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES (?, ?, ?, 'member')
  `).run(data.name, data.email, bcrypt.hashSync(data.password, 10));

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);

  const projectResult = db.prepare(`
    INSERT INTO projects (name, description, status, priority, due_date, owner_id, updated_at)
    VALUES (?, ?, 'active', 'medium', NULL, ?, CURRENT_TIMESTAMP)
  `).run(
    `${data.name.split(" ")[0]}'s Workspace`,
    "A starter workspace created automatically so new users can begin adding tasks right away.",
    user.id
  );

  db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(
    projectResult.lastInsertRowid,
    user.id
  );

  res.status(201).json({ token: signToken(user), user: formatUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const data = parseBody(loginSchema, req, res);
  if (!data) return;

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(data.email);

  if (!user || !bcrypt.compareSync(data.password, user.password_hash)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  res.json({ token: signToken(user), user: formatUser(user) });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: formatUser(user) });
});

app.get("/api/users", requireAuth, (req, res) => {
  const users = db
    .prepare("SELECT id, name, email, role, created_at FROM users ORDER BY name")
    .all()
    .map(formatUser);

  res.json({ users });
});

app.patch("/api/users/me", requireAuth, (req, res) => {
  const data = parseBody(profileSchema, req, res);
  if (!data) return;

  const duplicate = db
    .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
    .get(data.email, req.user.id);

  if (duplicate) {
    return res.status(409).json({ message: "Another user already uses this email address." });
  }

  db.prepare(`
    UPDATE users
    SET name = ?, email = ?
    WHERE id = ?
  `).run(data.name, data.email, req.user.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: formatUser(user), token: signToken(user) });
});

app.patch("/api/users/me/password", requireAuth, (req, res) => {
  const data = parseBody(passwordSchema, req, res);
  if (!data) return;

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

  if (!bcrypt.compareSync(data.currentPassword, user.password_hash)) {
    return res.status(400).json({ message: "Current password is incorrect." });
  }

  if (data.currentPassword === data.newPassword) {
    return res.status(400).json({ message: "Choose a new password that is different from the current one." });
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(data.newPassword, 10),
    req.user.id
  );

  res.json({ message: "Password updated successfully." });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const projectFilter =
    req.user.role === "admin"
      ? ""
      : `WHERE p.id IN (
           SELECT project_id FROM project_members WHERE user_id = ${Number(req.user.id)}
         )`;

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_projects,
      SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active_projects,
      SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed_projects
    FROM projects p
    ${projectFilter}
  `).get();

  const taskFilter =
    req.user.role === "admin"
      ? ""
      : `WHERE t.project_id IN (
           SELECT project_id FROM project_members WHERE user_id = ${Number(req.user.id)}
         )`;

  const taskStats = db.prepare(`
    SELECT
      COUNT(*) AS total_tasks,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_tasks,
      SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
      SUM(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS high_priority_tasks
    FROM tasks t
    ${taskFilter}
  `).get();

  const statusBreakdown = db.prepare(`
    SELECT t.status AS label, COUNT(*) AS value
    FROM tasks t
    ${taskFilter}
    GROUP BY t.status
    ORDER BY value DESC
  `).all();

  const priorityBreakdown = db.prepare(`
    SELECT t.priority AS label, COUNT(*) AS value
    FROM tasks t
    ${taskFilter}
    GROUP BY t.priority
    ORDER BY value DESC
  `).all();

  const upcomingTasks = db.prepare(`
    SELECT
      t.*,
      u.name AS assignee_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    ${taskFilter ? `${taskFilter} AND` : "WHERE"} t.status != 'done'
    ORDER BY COALESCE(t.due_date, '9999-12-31'), t.priority DESC
    LIMIT 5
  `).all().map(formatTask);

  res.json({
    summary: {
      totalProjects: summary.total_projects || 0,
      activeProjects: summary.active_projects || 0,
      completedProjects: summary.completed_projects || 0,
      totalTasks: taskStats.total_tasks || 0,
      completedTasks: taskStats.completed_tasks || 0,
      inProgressTasks: taskStats.in_progress_tasks || 0,
      highPriorityTasks: taskStats.high_priority_tasks || 0
    },
    charts: {
      statusBreakdown,
      priorityBreakdown
    },
    upcomingTasks
  });
});

app.get("/api/projects", requireAuth, (req, res) => {
  const projects = (
    req.user.role === "admin"
      ? db.prepare(`
          SELECT
            p.*,
            owner.name AS owner_name,
            COUNT(DISTINCT pm.user_id) AS member_count,
            COUNT(DISTINCT t.id) AS task_count,
            SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_task_count
          FROM projects p
          JOIN users owner ON owner.id = p.owner_id
          LEFT JOIN project_members pm ON pm.project_id = p.id
          LEFT JOIN tasks t ON t.project_id = p.id
          GROUP BY p.id
          ORDER BY p.updated_at DESC
        `).all()
      : db.prepare(`
          SELECT
            p.*,
            owner.name AS owner_name,
            COUNT(DISTINCT pm2.user_id) AS member_count,
            COUNT(DISTINCT t.id) AS task_count,
            SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_task_count
          FROM projects p
          JOIN users owner ON owner.id = p.owner_id
          JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
          LEFT JOIN project_members pm2 ON pm2.project_id = p.id
          LEFT JOIN tasks t ON t.project_id = p.id
          GROUP BY p.id
          ORDER BY p.updated_at DESC
        `).all(req.user.id)
  ).map((project) =>
    formatProject({
      ...project,
      completed_task_count: project.completed_task_count || 0
    })
  );

  res.json({ projects });
});

app.post("/api/projects", requireAuth, requireRole("admin"), (req, res) => {
  const data = parseBody(projectSchema, req, res);
  if (!data) return;

  const result = db.prepare(`
    INSERT INTO projects (name, description, status, priority, due_date, owner_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(data.name, data.description, data.status, data.priority, data.dueDate || null, req.user.id);

  db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(result.lastInsertRowid, req.user.id);

  const project = db.prepare(`
    SELECT p.*, u.name AS owner_name, 1 AS member_count, 0 AS task_count, 0 AS completed_task_count
    FROM projects p
    JOIN users u ON u.id = p.owner_id
    WHERE p.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ project: formatProject(project) });
});

app.put("/api/projects/:id", requireAuth, requireRole("admin"), (req, res) => {
  const data = parseBody(projectSchema, req, res);
  if (!data) return;

  const projectId = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);

  if (!existing) {
    return res.status(404).json({ message: "Project not found." });
  }

  db.prepare(`
    UPDATE projects
    SET name = ?, description = ?, status = ?, priority = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(data.name, data.description, data.status, data.priority, data.dueDate || null, projectId);

  const project = db.prepare(`
    SELECT
      p.*,
      owner.name AS owner_name,
      COUNT(DISTINCT pm.user_id) AS member_count,
      COUNT(DISTINCT t.id) AS task_count,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_task_count
    FROM projects p
    JOIN users owner ON owner.id = p.owner_id
    LEFT JOIN project_members pm ON pm.project_id = p.id
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(projectId);

  res.json({ project: formatProject({ ...project, completed_task_count: project.completed_task_count || 0 }) });
});

app.post("/api/projects/:id/members", requireAuth, requireRole("admin"), (req, res) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.body.userId);

  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    return res.status(404).json({ message: "Project not found." });
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)").run(projectId, userId);
  res.status(201).json({ message: "Member added successfully." });
});

app.get("/api/projects/:id/members", requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  const project = getAccessibleProject(projectId, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.created_at
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY
      CASE u.role WHEN 'admin' THEN 0 ELSE 1 END,
      u.name
  `).all(projectId).map(formatUser);

  res.json({ members });
});

app.get("/api/projects/:id/tasks", requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  const project = getAccessibleProject(projectId, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const tasks = db.prepare(`
    SELECT t.*, u.name AS assignee_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.project_id = ?
    ORDER BY
      CASE t.status
        WHEN 'todo' THEN 1
        WHEN 'in_progress' THEN 2
        WHEN 'review' THEN 3
        ELSE 4
      END,
      CASE t.priority
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        ELSE 3
      END,
      COALESCE(t.due_date, '9999-12-31')
  `).all(projectId).map(formatTask);

  res.json({ tasks });
});

app.post("/api/projects/:id/tasks", requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  const project = getAccessibleProject(projectId, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const data = parseBody(taskSchema, req, res);
  if (!data) return;

  if (!ensureProjectMembership(projectId, data.assignedTo)) {
    return res.status(400).json({ message: "Assigned user must be a member of this project." });
  }

  const completedAt = data.status === "done" ? new Date().toISOString() : null;
  const result = db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, assigned_to, due_date, created_by, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    projectId,
    data.title,
    data.description,
    data.status,
    data.priority,
    data.assignedTo || null,
    data.dueDate || null,
    req.user.id,
    completedAt
  );

  db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);

  const task = db.prepare(`
    SELECT t.*, u.name AS assignee_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ task: formatTask(task) });
});

app.put("/api/tasks/:id", requireAuth, (req, res) => {
  const taskId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);

  if (!existing) {
    return res.status(404).json({ message: "Task not found." });
  }

  const project = getAccessibleProject(existing.project_id, req.user);
  if (!project) {
    return res.status(403).json({ message: "You cannot modify this task." });
  }

  const isAssignedUser = existing.assigned_to === req.user.id;
  if (req.user.role !== "admin" && !isAssignedUser) {
    return res.status(403).json({ message: "Only admins or assignees can update tasks." });
  }

  const data = parseBody(taskSchema, req, res);
  if (!data) return;

  if (!ensureProjectMembership(existing.project_id, data.assignedTo)) {
    return res.status(400).json({ message: "Assigned user must be a member of this project." });
  }

  const completedAt =
    data.status === "done"
      ? existing.completed_at || new Date().toISOString()
      : null;

  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, status = ?, priority = ?, assigned_to = ?, due_date = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.title,
    data.description,
    data.status,
    data.priority,
    data.assignedTo || null,
    data.dueDate || null,
    completedAt,
    taskId
  );

  db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.project_id);

  const task = db.prepare(`
    SELECT t.*, u.name AS assignee_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.id = ?
  `).get(taskId);

  res.json({ task: formatTask(task) });
});

app.delete("/api/tasks/:id", requireAuth, requireRole("admin"), (req, res) => {
  const taskId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);

  if (!existing) {
    return res.status(404).json({ message: "Task not found." });
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.project_id);
  res.status(204).send();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
