import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

const db = new Database(fileURLToPath(new URL("../data/app.db", import.meta.url)));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('planning', 'active', 'completed', 'on_hold')) DEFAULT 'planning',
    priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    due_date TEXT,
    owner_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'review', 'done')) DEFAULT 'todo',
    priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    assigned_to INTEGER,
    due_date TEXT,
    created_by INTEGER NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

if (!userCount) {
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES (@name, @email, @password_hash, @role)
  `);

  const insertProject = db.prepare(`
    INSERT INTO projects (name, description, status, priority, due_date, owner_id)
    VALUES (@name, @description, @status, @priority, @due_date, @owner_id)
  `);

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)
  `);

  const insertTask = db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, assigned_to, due_date, created_by, completed_at)
    VALUES (@project_id, @title, @description, @status, @priority, @assigned_to, @due_date, @created_by, @completed_at)
  `);

  const adminId = insertUser.run({
    name: "Admin User",
    email: "admin@ethara.ai",
    password_hash: bcrypt.hashSync("Admin@123", 10),
    role: "admin"
  }).lastInsertRowid;

  const memberId = insertUser.run({
    name: "Demo Member",
    email: "member@ethara.ai",
    password_hash: bcrypt.hashSync("Member@123", 10),
    role: "member"
  }).lastInsertRowid;

  const projectId = insertProject.run({
    name: "Campus Hiring Portal",
    description: "Streamline candidate tracking, communication, and interview scheduling.",
    status: "active",
    priority: "high",
    due_date: "2026-05-20",
    owner_id: adminId
  }).lastInsertRowid;

  insertMember.run(projectId, adminId);
  insertMember.run(projectId, memberId);

  insertTask.run({
    project_id: projectId,
    title: "Build applicant dashboard",
    description: "Show round-wise counts, response rates, and recruiter actions.",
    status: "in_progress",
    priority: "high",
    assigned_to: memberId,
    due_date: "2026-05-12",
    created_by: adminId,
    completed_at: null
  });

  insertTask.run({
    project_id: projectId,
    title: "Secure recruiter login",
    description: "Implement JWT auth and protect management APIs.",
    status: "done",
    priority: "high",
    assigned_to: adminId,
    due_date: "2026-05-10",
    created_by: adminId,
    completed_at: "2026-05-09T18:00:00.000Z"
  });
}

export default db;
