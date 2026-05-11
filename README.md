# Task Manager Assessment App

A full-stack task manager built for assessment submission, with authentication, role-based access control, dashboard insights, project management, task workflows, and a polished responsive UI.

## Live Links

- Frontend: [https://vivek-task.netlify.app](https://vivek-task.netlify.app)
- Backend: [https://task-production-cf69.up.railway.app](https://task-production-cf69.up.railway.app)
- Health Check: [https://task-production-cf69.up.railway.app/api/health](https://task-production-cf69.up.railway.app/api/health)

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

Live frontend: [https://vivek-task.netlify.app](https://vivek-task.netlify.app)

Live backend: [https://task-production-cf69.up.railway.app](https://task-production-cf69.up.railway.app)

## Environment Files

Backend `.env`

```env
PORT=3000
JWT_SECRET=task_manager_assessment_secret
BASE_URL=https://task-production-cf69.up.railway.app
FRONTEND_URL=https://vivek-task.netlify.app
```

Frontend `.env`

```env
VITE_BASE_URL=https://task-production-cf69.up.railway.app
```

### Render Deployment Env

Backend service env:

```env
PORT=3000
JWT_SECRET=task_manager_super_secret_2026
BASE_URL=https://task-production-cf69.up.railway.app
FRONTEND_URL=https://vivek-task.netlify.app
```

Frontend service env:

```env
VITE_BASE_URL=https://task-production-cf69.up.railway.app
```

## Railway Deployment

Create two services from the same repository.

### Frontend Service

- Root Directory: `/frontend`
- Build Command: `npm install && npm run build`
- Start Command: `npm run start`

Frontend variable:

```env
VITE_BASE_URL=https://task-production-cf69.up.railway.app
```

### Backend Service

- Root Directory: `/backend`
- Build Command: `npm install`
- Start Command: `npm run start`

Backend variable:

```env
JWT_SECRET=task_manager_super_secret_2026
```

Notes:

- Railway provides `PORT` automatically, so you do not need to set it manually.
- Update the frontend `VITE_BASE_URL` after your backend gets its Railway public domain.

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
