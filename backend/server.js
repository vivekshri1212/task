import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
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
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const { users, projects, tasks } = await connectToDatabase();

app.use(cors());
app.use(express.json());

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

function toObjectId(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function formatUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function formatProject(project, ownerName, taskStats) {
  return {
    id: project._id.toString(),
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    dueDate: project.dueDate,
    ownerId: project.ownerId,
    ownerName,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    memberCount: project.memberIds.length,
    taskCount: taskStats?.taskCount || 0,
    completedTaskCount: taskStats?.completedTaskCount || 0
  };
}

function formatTask(task, assigneeName = null) {
  return {
    id: task._id.toString(),
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedTo: task.assignedTo,
    assignedToName: assigneeName,
    dueDate: task.dueDate,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt
  };
}

async function getUsersMap(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const objectIds = uniqueIds.map(toObjectId).filter(Boolean);

  if (!objectIds.length) {
    return new Map();
  }

  const foundUsers = await users.find({ _id: { $in: objectIds } }).toArray();
  return new Map(foundUsers.map((user) => [user._id.toString(), user]));
}

async function getAccessibleProject(projectId, user) {
  const objectId = toObjectId(projectId);

  if (!objectId) {
    return null;
  }

  const filter =
    user.role === "admin"
      ? { _id: objectId }
      : { _id: objectId, memberIds: user.id };

  return projects.findOne(filter);
}

function ensureProjectMembership(project, assignedTo) {
  if (!assignedTo) {
    return true;
  }

  return project.memberIds.includes(assignedTo);
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

async function getProjectTaskStats(projectIds) {
  if (!projectIds.length) {
    return new Map();
  }

  const stats = await tasks
    .aggregate([
      { $match: { projectId: { $in: projectIds } } },
      {
        $group: {
          _id: "$projectId",
          taskCount: { $sum: 1 },
          completedTaskCount: {
            $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] }
          }
        }
      }
    ])
    .toArray();

  return new Map(
    stats.map((entry) => [
      entry._id,
      {
        taskCount: entry.taskCount,
        completedTaskCount: entry.completedTaskCount
      }
    ])
  );
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

  const existingUser = await users.findOne({ email: data.email });
  if (existingUser) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  const now = new Date().toISOString();
  const userResult = await users.insertOne({
    name: data.name,
    email: data.email,
    passwordHash: bcrypt.hashSync(data.password, 10),
    role: "member",
    createdAt: now
  });

  const user = await users.findOne({ _id: userResult.insertedId });
  const userId = userResult.insertedId.toString();

  await projects.insertOne({
    name: `${data.name.split(" ")[0]}'s Workspace`,
    description: "A starter workspace created automatically so new users can begin adding tasks right away.",
    status: "active",
    priority: "medium",
    dueDate: null,
    ownerId: userId,
    memberIds: [userId],
    createdAt: now,
    updatedAt: now
  });

  res.status(201).json({ token: signToken(formatUser(user)), user: formatUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const data = parseBody(loginSchema, req, res);
  if (!data) return;

  const user = await users.findOne({ email: data.email });

  if (!user || !bcrypt.compareSync(data.password, user.passwordHash)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const formattedUser = formatUser(user);
  res.json({ token: signToken(formattedUser), user: formattedUser });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await users.findOne({ _id: toObjectId(req.user.id) });
  res.json({ user: formatUser(user) });
});

app.get("/api/users", requireAuth, async (_req, res) => {
  const allUsers = await users.find().sort({ name: 1 }).toArray();
  res.json({ users: allUsers.map(formatUser) });
});

app.patch("/api/users/me", requireAuth, async (req, res) => {
  const data = parseBody(profileSchema, req, res);
  if (!data) return;

  const currentUserId = toObjectId(req.user.id);
  const duplicate = await users.findOne({
    email: data.email,
    _id: { $ne: currentUserId }
  });

  if (duplicate) {
    return res.status(409).json({ message: "Another user already uses this email address." });
  }

  await users.updateOne(
    { _id: currentUserId },
    { $set: { name: data.name, email: data.email } }
  );

  const user = await users.findOne({ _id: currentUserId });
  const formattedUser = formatUser(user);
  res.json({ user: formattedUser, token: signToken(formattedUser) });
});

app.patch("/api/users/me/password", requireAuth, async (req, res) => {
  const data = parseBody(passwordSchema, req, res);
  if (!data) return;

  const user = await users.findOne({ _id: toObjectId(req.user.id) });

  if (!bcrypt.compareSync(data.currentPassword, user.passwordHash)) {
    return res.status(400).json({ message: "Current password is incorrect." });
  }

  if (data.currentPassword === data.newPassword) {
    return res.status(400).json({ message: "Choose a new password that is different from the current one." });
  }

  await users.updateOne(
    { _id: user._id },
    { $set: { passwordHash: bcrypt.hashSync(data.newPassword, 10) } }
  );

  res.json({ message: "Password updated successfully." });
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  const visibleProjects = await projects
    .find(req.user.role === "admin" ? {} : { memberIds: req.user.id })
    .toArray();

  const projectIds = visibleProjects.map((project) => project._id.toString());
  const visibleTasks = projectIds.length
    ? await tasks.find(req.user.role === "admin" ? {} : { projectId: { $in: projectIds } }).toArray()
    : [];

  const summary = {
    totalProjects: visibleProjects.length,
    activeProjects: visibleProjects.filter((project) => project.status === "active").length,
    completedProjects: visibleProjects.filter((project) => project.status === "completed").length,
    totalTasks: visibleTasks.length,
    completedTasks: visibleTasks.filter((task) => task.status === "done").length,
    inProgressTasks: visibleTasks.filter((task) => task.status === "in_progress").length,
    highPriorityTasks: visibleTasks.filter((task) => task.priority === "high").length
  };

  const assignees = await getUsersMap(visibleTasks.map((task) => task.assignedTo));
  const upcomingTasks = sortTasks(visibleTasks.filter((task) => task.status !== "done"))
    .slice(0, 5)
    .map((task) => formatTask(task, assignees.get(task.assignedTo)?.name || null));

  res.json({
    summary,
    charts: {
      statusBreakdown: buildBreakdown(visibleTasks, "status"),
      priorityBreakdown: buildBreakdown(visibleTasks, "priority")
    },
    upcomingTasks
  });
});

app.get("/api/projects", requireAuth, async (req, res) => {
  const visibleProjects = await projects
    .find(req.user.role === "admin" ? {} : { memberIds: req.user.id })
    .sort({ updatedAt: -1 })
    .toArray();

  const projectIds = visibleProjects.map((project) => project._id.toString());
  const ownerMap = await getUsersMap(visibleProjects.map((project) => project.ownerId));
  const taskStats = await getProjectTaskStats(projectIds);

  res.json({
    projects: visibleProjects.map((project) =>
      formatProject(project, ownerMap.get(project.ownerId)?.name || "Unknown Owner", taskStats.get(project._id.toString()))
    )
  });
});

app.post("/api/projects", requireAuth, requireRole("admin"), async (req, res) => {
  const data = parseBody(projectSchema, req, res);
  if (!data) return;

  const now = new Date().toISOString();
  const result = await projects.insertOne({
    name: data.name,
    description: data.description,
    status: data.status,
    priority: data.priority,
    dueDate: data.dueDate || null,
    ownerId: req.user.id,
    memberIds: [req.user.id],
    createdAt: now,
    updatedAt: now
  });

  const project = await projects.findOne({ _id: result.insertedId });
  res.status(201).json({
    project: formatProject(project, req.user.name, { taskCount: 0, completedTaskCount: 0 })
  });
});

app.put("/api/projects/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const data = parseBody(projectSchema, req, res);
  if (!data) return;

  const projectId = toObjectId(req.params.id);
  if (!projectId) {
    return res.status(404).json({ message: "Project not found." });
  }

  const existing = await projects.findOne({ _id: projectId });
  if (!existing) {
    return res.status(404).json({ message: "Project not found." });
  }

  await projects.updateOne(
    { _id: projectId },
    {
      $set: {
        name: data.name,
        description: data.description,
        status: data.status,
        priority: data.priority,
        dueDate: data.dueDate || null,
        updatedAt: new Date().toISOString()
      }
    }
  );

  const project = await projects.findOne({ _id: projectId });
  const owner = await users.findOne({ _id: toObjectId(project.ownerId) });
  const stats = await getProjectTaskStats([project._id.toString()]);

  res.json({
    project: formatProject(project, owner?.name || "Unknown Owner", stats.get(project._id.toString()))
  });
});

app.post("/api/projects/:id/members", requireAuth, requireRole("admin"), async (req, res) => {
  const project = await projects.findOne({ _id: toObjectId(req.params.id) });
  if (!project) {
    return res.status(404).json({ message: "Project not found." });
  }

  const userId = String(req.body.userId || "").trim();
  if (!toObjectId(userId)) {
    return res.status(400).json({ message: "A valid user is required." });
  }

  const user = await users.findOne({ _id: toObjectId(userId) });
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  await projects.updateOne(
    { _id: project._id },
    {
      $addToSet: { memberIds: userId },
      $set: { updatedAt: new Date().toISOString() }
    }
  );

  res.status(201).json({ message: "Member added successfully." });
});

app.get("/api/projects/:id/members", requireAuth, async (req, res) => {
  const project = await getAccessibleProject(req.params.id, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const memberUsers = await users
    .find({ _id: { $in: project.memberIds.map(toObjectId).filter(Boolean) } })
    .toArray();

  memberUsers.sort((left, right) => {
    const roleRank = left.role === right.role ? 0 : left.role === "admin" ? -1 : 1;
    return roleRank || left.name.localeCompare(right.name);
  });

  res.json({ members: memberUsers.map(formatUser) });
});

app.get("/api/projects/:id/tasks", requireAuth, async (req, res) => {
  const project = await getAccessibleProject(req.params.id, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const projectTasks = await tasks.find({ projectId: project._id.toString() }).toArray();
  const assignees = await getUsersMap(projectTasks.map((task) => task.assignedTo));

  res.json({
    tasks: sortTasks(projectTasks).map((task) => formatTask(task, assignees.get(task.assignedTo)?.name || null))
  });
});

app.post("/api/projects/:id/tasks", requireAuth, async (req, res) => {
  const project = await getAccessibleProject(req.params.id, req.user);

  if (!project) {
    return res.status(404).json({ message: "Project not found or not accessible." });
  }

  const data = parseBody(taskSchema, req, res);
  if (!data) return;

  if (!ensureProjectMembership(project, data.assignedTo)) {
    return res.status(400).json({ message: "Assigned user must be a member of this project." });
  }

  const now = new Date().toISOString();
  const completedAt = data.status === "done" ? now : null;
  const result = await tasks.insertOne({
    projectId: project._id.toString(),
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    assignedTo: data.assignedTo || null,
    dueDate: data.dueDate || null,
    createdBy: req.user.id,
    completedAt,
    createdAt: now,
    updatedAt: now
  });

  await projects.updateOne(
    { _id: project._id },
    { $set: { updatedAt: now } }
  );

  const task = await tasks.findOne({ _id: result.insertedId });
  const assignee = task.assignedTo ? await users.findOne({ _id: toObjectId(task.assignedTo) }) : null;

  res.status(201).json({ task: formatTask(task, assignee?.name || null) });
});

app.put("/api/tasks/:id", requireAuth, async (req, res) => {
  const taskId = toObjectId(req.params.id);
  const existing = taskId ? await tasks.findOne({ _id: taskId }) : null;

  if (!existing) {
    return res.status(404).json({ message: "Task not found." });
  }

  const project = await getAccessibleProject(existing.projectId, req.user);
  if (!project) {
    return res.status(403).json({ message: "You cannot modify this task." });
  }

  const isAssignedUser = existing.assignedTo === req.user.id;
  if (req.user.role !== "admin" && !isAssignedUser) {
    return res.status(403).json({ message: "Only admins or assignees can update tasks." });
  }

  const data = parseBody(taskSchema, req, res);
  if (!data) return;

  if (!ensureProjectMembership(project, data.assignedTo)) {
    return res.status(400).json({ message: "Assigned user must be a member of this project." });
  }

  const completedAt = data.status === "done" ? existing.completedAt || new Date().toISOString() : null;

  await tasks.updateOne(
    { _id: existing._id },
    {
      $set: {
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        assignedTo: data.assignedTo || null,
        dueDate: data.dueDate || null,
        completedAt,
        updatedAt: new Date().toISOString()
      }
    }
  );

  await projects.updateOne(
    { _id: project._id },
    { $set: { updatedAt: new Date().toISOString() } }
  );

  const task = await tasks.findOne({ _id: existing._id });
  const assignee = task.assignedTo ? await users.findOne({ _id: toObjectId(task.assignedTo) }) : null;

  res.json({ task: formatTask(task, assignee?.name || null) });
});

app.delete("/api/tasks/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const taskId = toObjectId(req.params.id);
  const existing = taskId ? await tasks.findOne({ _id: taskId }) : null;

  if (!existing) {
    return res.status(404).json({ message: "Task not found." });
  }

  await tasks.deleteOne({ _id: existing._id });
  await projects.updateOne(
    { _id: toObjectId(existing.projectId) },
    { $set: { updatedAt: new Date().toISOString() } }
  );

  res.status(204).send();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`API running on ${BASE_URL}`);
});
