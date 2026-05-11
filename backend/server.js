import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "./src/db.js";
import { requireAuth, requireRole, signToken } from "./src/auth.js";
import {
  loginSchema,
  passwordSchema,
  profileSchema,
  projectSchema,
  registerSchema,
  taskSchema
} from "./src/validators.js";

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const FRONTEND_URLS = (process.env.FRONTEND_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DEBUG_REQUESTS = process.env.DEBUG_REQUESTS !== "false";
const db = await connectToDatabase();

const allowedOrigins = new Set([
  FRONTEND_URL,
  ...FRONTEND_URLS,
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

process.on("unhandledRejection", (error) => {
  console.error("[process] unhandledRejection", error);
});

process.on("uncaughtException", (error) => {
  console.error("[process] uncaughtException", error);
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      console.error("[cors] blocked origin", origin);
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  })
);
app.use(express.json());
app.use((req, _res, next) => {
  if (DEBUG_REQUESTS) {
    console.log(`[request] ${req.method} ${req.path}`, {
      origin: req.headers.origin || "direct",
      host: req.headers.host
    });
  }

  next();
});

const TASK_STATUS_ORDER = {
  todo: 1,
  in_progress: 2,
  review: 3,
  done: 4
};

const TASK_PRIORITY_ORDER = {
  high: 1,
  medium: 2,
  low: 3
};

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

function toId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatTimestamp(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatDateValue(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function formatUser(user) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: formatTimestamp(user.created_at)
  };
}

function formatProject(project) {
  return {
    id: String(project.id),
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    dueDate: formatDateValue(project.due_date),
    ownerId: String(project.owner_id),
    ownerName: project.owner_name,
    createdAt: formatTimestamp(project.created_at),
    updatedAt: formatTimestamp(project.updated_at),
    memberCount: Number(project.member_count) || 0,
    taskCount: Number(project.task_count) || 0,
    completedTaskCount: Number(project.completed_task_count) || 0
  };
}

function formatTask(task) {
  return {
    id: String(task.id),
    projectId: String(task.project_id),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedTo: task.assigned_to ? String(task.assigned_to) : null,
    assignedToName: task.assignee_name || null,
    dueDate: formatDateValue(task.due_date),
    createdBy: String(task.created_by),
    createdAt: formatTimestamp(task.created_at),
    updatedAt: formatTimestamp(task.updated_at),
    completedAt: formatTimestamp(task.completed_at)
  };
}

function sortTasks(taskList) {
  return [...taskList].sort((left, right) => {
    const statusDifference = TASK_STATUS_ORDER[left.status] - TASK_STATUS_ORDER[right.status];
    if (statusDifference !== 0) {
      return statusDifference;
    }

    const priorityDifference = TASK_PRIORITY_ORDER[left.priority] - TASK_PRIORITY_ORDER[right.priority];
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31");
  });
}

function buildBreakdown(items, key) {
  const counts = items.reduce((accumulator, item) => {
    accumulator[item[key]] = (accumulator[item[key]] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

async function getUserById(userId) {
  const result = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

async function getAccessibleProject(projectId, user) {
  const normalizedProjectId = toId(projectId);

  if (!normalizedProjectId) {
    return null;
  }

  const result = await db.query(
    user.role === "admin"
      ? "SELECT * FROM projects WHERE id = $1"
      : `
          SELECT p.*
          FROM projects p
          JOIN project_members pm ON pm.project_id = p.id
          WHERE p.id = $1 AND pm.user_id = $2
        `,
    user.role === "admin" ? [normalizedProjectId] : [normalizedProjectId, toId(user.id)]
  );

  return result.rows[0] || null;
}

async function ensureProjectMembership(projectId, assignedTo) {
  if (!assignedTo) {
    return true;
  }

  const result = await db.query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, toId(assignedTo)]
  );

  return result.rowCount > 0;
}

async function getVisibleProjects(user) {
  const result = await db.query(
    user.role === "admin"
      ? `
          SELECT
            p.*,
            owner.name AS owner_name,
            COUNT(DISTINCT pm.user_id)::int AS member_count,
            COUNT(DISTINCT t.id)::int AS task_count,
            COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0)::int AS completed_task_count
          FROM projects p
          JOIN users owner ON owner.id = p.owner_id
          LEFT JOIN project_members pm ON pm.project_id = p.id
          LEFT JOIN tasks t ON t.project_id = p.id
          GROUP BY p.id, owner.name
          ORDER BY p.updated_at DESC
        `
      : `
          SELECT
            p.*,
            owner.name AS owner_name,
            COUNT(DISTINCT pm2.user_id)::int AS member_count,
            COUNT(DISTINCT t.id)::int AS task_count,
            COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0)::int AS completed_task_count
          FROM projects p
          JOIN users owner ON owner.id = p.owner_id
          JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
          LEFT JOIN project_members pm2 ON pm2.project_id = p.id
          LEFT JOIN tasks t ON t.project_id = p.id
          GROUP BY p.id, owner.name
          ORDER BY p.updated_at DESC
        `,
    user.role === "admin" ? [] : [toId(user.id)]
  );

  return result.rows.map(formatProject);
}

async function getVisibleTasks(user, projectIds = []) {
  if (user.role !== "admin" && projectIds.length === 0) {
    return [];
  }

  const result = await db.query(
    user.role === "admin"
      ? `
          SELECT t.*, u.name AS assignee_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assigned_to
        `
      : `
          SELECT t.*, u.name AS assignee_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.project_id = ANY($1::bigint[])
        `,
    user.role === "admin" ? [] : [projectIds]
  );

  return result.rows.map(formatTask);
}

app.get("/", (_req, res) => {
  res.json({
    message: "Task Manager API is running.",
    baseUrl: BASE_URL,
    health: `${BASE_URL.replace(/\/$/, "")}/api/health`
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const data = parseBody(registerSchema, req, res);
  if (!data) return;

  const existingUser = await db.query("SELECT id FROM users WHERE email = $1", [data.email]);
  if (existingUser.rowCount > 0) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  const user = await db.withTransaction(async (client) => {
    const createdUser = await client.query(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, 'member')
        RETURNING *
      `,
      [data.name, data.email, bcrypt.hashSync(data.password, 10)]
    );

    const createdProject = await client.query(
      `
        INSERT INTO projects (name, description, status, priority, due_date, owner_id)
        VALUES ($1, $2, 'active', 'medium', NULL, $3)
        RETURNING id
      `,
      [
        `${data.name.split(" ")[0]}'s Workspace`,
        "A starter workspace created automatically so new users can begin adding tasks right away.",
        createdUser.rows[0].id
      ]
    );

    await client.query(
      "INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)",
      [createdProject.rows[0].id, createdUser.rows[0].id]
    );

    return createdUser.rows[0];
  });

  const formattedUser = formatUser(user);
  res.status(201).json({ token: signToken(formattedUser), user: formattedUser });
});

app.post("/api/auth/login", async (req, res) => {
  const data = parseBody(loginSchema, req, res);
  if (!data) return;

  const result = await db.query("SELECT * FROM users WHERE email = $1", [data.email]);
  const user = result.rows[0];

  if (!user || !bcrypt.compareSync(data.password, user.password_hash)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const formattedUser = formatUser(user);
  res.json({ token: signToken(formattedUser), user: formattedUser });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await getUserById(toId(req.user.id));
  res.json({ user: formatUser(user) });
});

app.get("/api/users", requireAuth, async (_req, res) => {
  const result = await db.query("SELECT * FROM users ORDER BY name");
  res.json({ users: result.rows.map(formatUser) });
});

app.patch("/api/users/me", requireAuth, async (req, res) => {
  const data = parseBody(profileSchema, req, res);
  if (!data) return;

  const duplicate = await db.query(
    "SELECT id FROM users WHERE email = $1 AND id != $2",
    [data.email, toId(req.user.id)]
  );

  if (duplicate.rowCount > 0) {
    return res.status(409).json({ message: "Another user already uses this email address." });
  }

  const result = await db.query(
    `
      UPDATE users
      SET name = $1, email = $2
      WHERE id = $3
      RETURNING *
    `,
    [data.name, data.email, toId(req.user.id)]
  );

  const formattedUser = formatUser(result.rows[0]);
  res.json({ user: formattedUser, token: signToken(formattedUser) });
});

app.patch("/api/users/me/password", requireAuth, async (req, res) => {
  const data = parseBody(passwordSchema, req, res);
  if (!data) return;

  const user = await getUserById(toId(req.user.id));

  if (!bcrypt.compareSync(data.currentPassword, user.password_hash)) {
    return res.status(400).json({ message: "Current password is incorrect." });
  }

  if (data.currentPassword === data.newPassword) {
    return res.status(400).json({ message: "Choose a new password that is different from the current one." });
  }

  await db.query(
    "UPDATE users SET password_hash = $1 WHERE id = $2",
    [bcrypt.hashSync(data.newPassword, 10), toId(req.user.id)]
  );

  res.json({ message: "Password updated successfully." });
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  const projects = await getVisibleProjects(req.user);
  const projectIds = projects.map((project) => Number(project.id));
  const tasks = await getVisibleTasks(req.user, projectIds);

  const summary = {
    totalProjects: projects.length,
    activeProjects: projects.filter((project) => project.status === "active").length,
    completedProjects: projects.filter((project) => project.status === "completed").length,
    totalTasks: tasks.length,
    completedTasks: tasks.filter((task) => task.status === "done").length,
    inProgressTasks: tasks.filter((task) => task.status === "in_progress").length,
    highPriorityTasks: tasks.filter((task) => task.priority === "high").length
  };

  const upcomingTasks = sortTasks(tasks.filter((task) => task.status !== "done")).slice(0, 5);

  res.json({
    summary,
    charts: {
      statusBreakdown: buildBreakdown(tasks, "status"),
      priorityBreakdown: buildBreakdown(tasks, "priority")
    },
    upcomingTasks
  });
});

app.get("/api/projects", requireAuth, async (req, res) => {
  const projects = await getVisibleProjects(req.user);
  res.json({ projects });
});

app.post("/api/projects", requireAuth, requireRole("admin"), async (req, res) => {
  const data = parseBody(projectSchema, req, res);
  if (!data) return;

  const result = await db.query(
    `
      INSERT INTO projects (name, description, status, priority, due_date, owner_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [data.name, data.description, data.status, data.priority, data.dueDate || null, toId(req.user.id)]
  );

  await db.query(
    "INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)",
    [result.rows[0].id, toId(req.user.id)]
  );

  res.status(201).json({
    project: formatProject({
      ...result.rows[0],
      owner_name: req.user.name,
      member_count: 1,
      task_count: 0,
      completed_task_count: 0
    })
  });
});

app.put("/api/projects/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const data = parseBody(projectSchema, req, res);
  if (!data) return;

  const projectId = toId(req.params.id);
  const existing = await db.query("SELECT id FROM projects WHERE id = $1", [projectId]);

  if (existing.rowCount === 0) {
    return res.status(404).json({ message: "Project not found." });
  }

  await db.query(
    `
      UPDATE projects
      SET name = $1, description = $2, status = $3, priority = $4, due_date = $5, updated_at = NOW()
      WHERE id = $6
    `,
    [data.name, data.description, data.status, data.priority, data.dueDate || null, projectId]
  );

  const refreshed = await getVisibleProjects(req.user);
  const project = refreshed.find((entry) => entry.id === String(projectId));
  res.json({ project });
});

app.post("/api/projects/:id/members", requireAuth, requireRole("admin"), async (req, res) => {
  const projectId = toId(req.params.id);
  const userId = toId(req.body.userId);

  const project = await db.query("SELECT id FROM projects WHERE id = $1", [projectId]);
  if (project.rowCount === 0) {
    return res.status(404).json({ message: "Project not found." });
  }

  const user = await db.query("SELECT id FROM users WHERE id = $1", [userId]);
  if (user.rowCount === 0) {
    return res.status(404).json({ message: "User not found." });
  }

  await db.query(
    `
      INSERT INTO project_members (project_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (project_id, user_id) DO NOTHING
    `,
    [projectId, userId]
  );

  await db.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [projectId]);
  res.status(201).json({ message: "Member added successfully." });
});

app.get("/api/projects/:id/members", requireAuth, async (req, res) => {
  const project = await getAccessibleProject(req.params.id, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const result = await db.query(
    `
      SELECT u.*
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.name
    `,
    [project.id]
  );

  res.json({ members: result.rows.map(formatUser) });
});

app.get("/api/projects/:id/tasks", requireAuth, async (req, res) => {
  const project = await getAccessibleProject(req.params.id, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const result = await db.query(
    `
      SELECT t.*, u.name AS assignee_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.project_id = $1
    `,
    [project.id]
  );

  res.json({ tasks: sortTasks(result.rows.map(formatTask)) });
});

app.post("/api/projects/:id/tasks", requireAuth, async (req, res) => {
  const project = await getAccessibleProject(req.params.id, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const data = parseBody(taskSchema, req, res);
  if (!data) return;

  if (!(await ensureProjectMembership(project.id, data.assignedTo))) {
    return res.status(400).json({ message: "Assigned user must be a member of this project." });
  }

  const completedAt = data.status === "done" ? new Date().toISOString() : null;
  const result = await db.query(
    `
      INSERT INTO tasks (project_id, title, description, status, priority, assigned_to, due_date, created_by, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      project.id,
      data.title,
      data.description,
      data.status,
      data.priority,
      data.assignedTo ? toId(data.assignedTo) : null,
      data.dueDate || null,
      toId(req.user.id),
      completedAt
    ]
  );

  await db.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [project.id]);

  const task = await db.query(
    `
      SELECT t.*, u.name AS assignee_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id = $1
    `,
    [result.rows[0].id]
  );

  res.status(201).json({ task: formatTask(task.rows[0]) });
});

app.put("/api/tasks/:id", requireAuth, async (req, res) => {
  const taskId = toId(req.params.id);
  const existingResult = await db.query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  const existing = existingResult.rows[0];

  if (!existing) {
    return res.status(404).json({ message: "Task not found." });
  }

  const project = await getAccessibleProject(existing.project_id, req.user);
  if (!project) {
    return res.status(403).json({ message: "You cannot modify this task." });
  }

  const isAssignedUser = existing.assigned_to === toId(req.user.id);
  if (req.user.role !== "admin" && !isAssignedUser) {
    return res.status(403).json({ message: "Only admins or assignees can update tasks." });
  }

  const data = parseBody(taskSchema, req, res);
  if (!data) return;

  if (!(await ensureProjectMembership(project.id, data.assignedTo))) {
    return res.status(400).json({ message: "Assigned user must be a member of this project." });
  }

  const completedAt = data.status === "done" ? existing.completed_at || new Date().toISOString() : null;

  await db.query(
    `
      UPDATE tasks
      SET
        title = $1,
        description = $2,
        status = $3,
        priority = $4,
        assigned_to = $5,
        due_date = $6,
        completed_at = $7,
        updated_at = NOW()
      WHERE id = $8
    `,
    [
      data.title,
      data.description,
      data.status,
      data.priority,
      data.assignedTo ? toId(data.assignedTo) : null,
      data.dueDate || null,
      completedAt,
      taskId
    ]
  );

  await db.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [project.id]);

  const task = await db.query(
    `
      SELECT t.*, u.name AS assignee_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id = $1
    `,
    [taskId]
  );

  res.json({ task: formatTask(task.rows[0]) });
});

app.delete("/api/tasks/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const taskId = toId(req.params.id);
  const existingResult = await db.query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  const existing = existingResult.rows[0];

  if (!existing) {
    return res.status(404).json({ message: "Task not found." });
  }

  await db.query("DELETE FROM tasks WHERE id = $1", [taskId]);
  await db.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [existing.project_id]);
  res.status(204).send();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on the server." });
});

app.listen(PORT, HOST, () => {
  console.log("API running", {
    BASE_URL,
    FRONTEND_URL,
    FRONTEND_URLS,
    HOST,
    PORT,
    allowedOrigins: [...allowedOrigins]
  });
});
