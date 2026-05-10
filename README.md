# Task Manager Assessment App

A full-stack task manager built for assessment submission, with authentication, role-based access control, dashboard insights, project management, task workflows, and a polished responsive UI.

## Repository Name

Recommended GitHub repository name: `task-manager-assessment-app`

## Stack

- Frontend: React + Vite + Recharts
- Backend: Node.js + Express
- Database: SQLite with `better-sqlite3`
- Auth: JWT + bcrypt password hashing

## Features

- Login and registration flow
- Role-based access control for `admin` and `member`
- Project creation and editing
- Project member assignment
- Task creation, updates, deletion, and workflow status tracking
- Dashboard cards and charts for delivery visibility
- Validation, error states, loading states, and mobile-responsive layout
- Profile update and password change support

## Demo Accounts

- Admin: `admin@ethara.ai` / `Admin@123`
- Member: `member@ethara.ai` / `Member@123`

## Run Locally

```bash
npm.cmd install
npm.cmd run dev:backend
npm.cmd run dev:frontend
```

Frontend runs on `http://localhost:5173` and backend runs on `http://localhost:4000`.

## Assessment Highlights

- Secure login and registration flow with JWT-based authentication
- Role-based permissions for admin and member users
- Project-based task creation and tracking
- Dashboard with task status and priority visualizations
- Clean, responsive interface designed for desktop and mobile screens

## Notes

- The SQLite database is created automatically in `backend/data/app.db`.
- New registrations are created as `member` users by default.
- Only admins can create projects, assign members, and delete tasks.
