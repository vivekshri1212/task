import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to connect to MongoDB.");
}

const databaseName = (() => {
  try {
    const parsedUrl = new URL(DATABASE_URL);
    const pathname = parsedUrl.pathname.replace(/^\/+/, "");
    return pathname || "task_manager_assessment";
  } catch {
    return "task_manager_assessment";
  }
})();

const client = new MongoClient(DATABASE_URL);

let db;
let users;
let projects;
let tasks;

async function ensureIndexes() {
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    projects.createIndex({ ownerId: 1 }),
    projects.createIndex({ memberIds: 1 }),
    tasks.createIndex({ projectId: 1 }),
    tasks.createIndex({ assignedTo: 1 })
  ]);
}

async function seedDatabase() {
  const userCount = await users.countDocuments();

  if (userCount) {
    return;
  }

  const now = new Date().toISOString();

  const adminResult = await users.insertOne({
    name: "Admin User",
    email: "admin@ethara.ai",
    passwordHash: bcrypt.hashSync("Admin@123", 10),
    role: "admin",
    createdAt: now
  });

  const memberResult = await users.insertOne({
    name: "Demo Member",
    email: "member@ethara.ai",
    passwordHash: bcrypt.hashSync("Member@123", 10),
    role: "member",
    createdAt: now
  });

  const adminId = adminResult.insertedId.toString();
  const memberId = memberResult.insertedId.toString();

  const projectResult = await projects.insertOne({
    name: "Campus Hiring Portal",
    description: "Streamline candidate tracking, communication, and interview scheduling.",
    status: "active",
    priority: "high",
    dueDate: "2026-05-20",
    ownerId: adminId,
    memberIds: [adminId, memberId],
    createdAt: now,
    updatedAt: now
  });

  const projectId = projectResult.insertedId.toString();

  await tasks.insertMany([
    {
      projectId,
      title: "Build applicant dashboard",
      description: "Show round-wise counts, response rates, and recruiter actions.",
      status: "in_progress",
      priority: "high",
      assignedTo: memberId,
      dueDate: "2026-05-12",
      createdBy: adminId,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    },
    {
      projectId,
      title: "Secure recruiter login",
      description: "Implement JWT auth and protect management APIs.",
      status: "done",
      priority: "high",
      assignedTo: adminId,
      dueDate: "2026-05-10",
      createdBy: adminId,
      completedAt: "2026-05-09T18:00:00.000Z",
      createdAt: now,
      updatedAt: now
    }
  ]);
}

export async function connectToDatabase() {
  if (db) {
    return { db, users, projects, tasks };
  }

  await client.connect();

  db = client.db(databaseName);
  users = db.collection("users");
  projects = db.collection("projects");
  tasks = db.collection("tasks");

  await ensureIndexes();
  await seedDatabase();

  return { db, users, projects, tasks };
}
