# Task Manager

## Project layout

The React/Vite frontend lives at the repository root alongside `package.json`;
there is no `frontend` directory. Run frontend commands from
`C:\Users\nithi\Desktop\TanStack-Query`.

## Database setup

1. Create a local MySQL database by running `backend/schema.sql` with a MySQL client.
   The script creates `task_manager`, the `users` and `tasks` tables, and repeatable
   sample records. Sample passwords are deliberately placeholders; create a real
   account using the app's registration page.
2. Copy `backend/.env.example` to `backend/.env` and set your MySQL credentials.
   Set `JWT_SECRET_KEY` to a long random value too. Flask loads this file on
   startup; environment variables already set in the shell take precedence.

   You can also configure credentials in PowerShell instead:

   ```powershell
   $env:MYSQL_USER = "root"
   $env:MYSQL_PASSWORD = "your-local-mysql-password"
   ```
3. Install backend dependencies and start the API:

   ```powershell
   Set-Location C:\Users\nithi\Desktop\TanStack-Query\backend
   ..\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ..\.venv\Scripts\python.exe app.py
   ```

   The JWT secret should remain unchanged between API restarts so existing
   sessions remain valid.

## Frontend

```powershell
Set-Location C:\Users\nithi\Desktop\TanStack-Query
npm install
npm run dev
```

The Vite development server proxies `/api` calls to Flask at
`http://127.0.0.1:5001` (`FLASK_PORT` in `backend/.env`). The task API supports list, create, update, and delete
operations backed by MySQL. Register an account or sign in at `/login`.

The dashboard loads summary counts, team members, and the current task page in
parallel. Task search/status filters and pagination are server-side. The task
detail route loads its assignee with a dependent query. Query state is available
in the React Query Devtools; task lists and dashboard summary poll every
10 seconds and mutations invalidate affected caches immediately.

After signing in, use **Change password** in the dashboard header to update your
password. The form verifies your current password, and the API stores the new
password as a bcrypt hash.
