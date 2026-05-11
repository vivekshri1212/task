import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
}

const poolConfig = {
  connectionString: DATABASE_URL
};

if (DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("neon.tech")) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(run) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('planning', 'active', 'completed', 'on_hold')) DEFAULT 'planning',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
      due_date DATE,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'review', 'done')) DEFAULT 'todo',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
      assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
      due_date DATE,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedDatabase() {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM users");

  if (rows[0].count > 0) {
    return;
  }

  await withTransaction(async (client) => {
    const adminResult = await client.query(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, 'admin')
        RETURNING id
      `,
      ["Admin User", "admin@ethara.ai", bcrypt.hashSync("Admin@123", 10)]
    );

    const memberResult = await client.query(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, 'member')
        RETURNING id
      `,
      ["Demo Member", "member@ethara.ai", bcrypt.hashSync("Member@123", 10)]
    );

    const adminId = adminResult.rows[0].id;
    const memberId = memberResult.rows[0].id;

    const projectResult = await client.query(
      `
        INSERT INTO projects (name, description, status, priority, due_date, owner_id)
        VALUES ($1, $2, 'active', 'high', $3, $4)
        RETURNING id
      `,
      [
        "Campus Hiring Portal",
        "Streamline candidate tracking, communication, and interview scheduling.",
        "2026-05-20",
        adminId
      ]
    );

    const projectId = projectResult.rows[0].id;

    await client.query(
      `
        INSERT INTO project_members (project_id, user_id)
        VALUES ($1, $2), ($1, $3)
      `,
      [projectId, adminId, memberId]
    );

    await client.query(
      `
        INSERT INTO tasks (project_id, title, description, status, priority, assigned_to, due_date, created_by, completed_at)
        VALUES
          ($1, $2, $3, 'in_progress', 'high', $4, $5, $6, NULL),
          ($1, $7, $8, 'done', 'high', $6, $9, $6, $10)
      `,
      [
        projectId,
        "Build applicant dashboard",
        "Show round-wise counts, response rates, and recruiter actions.",
        memberId,
        "2026-05-12",
        adminId,
        "Secure recruiter login",
        "Implement JWT auth and protect management APIs.",
        "2026-05-10",
        "2026-05-09T18:00:00.000Z"
      ]
    );
  });
}

export async function connectToDatabase() {
  await query("SELECT 1");
  await ensureSchema();
  await seedDatabase();
  return { query, withTransaction };
}
