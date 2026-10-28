import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import axios from 'axios'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import {
  api,
  getApiErrorMessage,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from './api/api'
import { useAuth } from './auth/AuthContext'

const taskQueryKey = ['tasks']
const statusOptions: TaskStatus[] = ['todo', 'in_progress', 'done']
const priorityOptions: TaskPriority[] = ['low', 'medium', 'high']

function ApiError({ error, prefix }: { error: unknown; prefix?: string }) {
  return (
    <div className="status-box error" role="alert">
      {prefix ? `${prefix}: ` : ''}{getApiErrorMessage(error)}
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { token, signOut } = useAuth()
  const userQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getCurrentUser,
    enabled: Boolean(token),
    retry: false,
  })

  useEffect(() => {
    if (axios.isAxiosError(userQuery.error) && userQuery.error.response?.status === 401) {
      signOut()
    }
  }, [signOut, userQuery.error])

  if (!token) return <Navigate to="/login" replace />
  if (userQuery.isPending || userQuery.isFetching && !userQuery.data) {
    return <LoadingPage label="Checking your session..." />
  }
  if (userQuery.isError) {
    return <main className="app-shell"><ApiError error={userQuery.error} prefix="Could not verify session" /></main>
  }
  return <>{children}</>
}

function LoadingPage({ label }: { label: string }) {
  return (
    <main className="app-shell">
      <p className="eyebrow">{label}</p>
      <div className="skeleton skeleton-heading" />
      <div className="stats-grid">
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
      </div>
      <div className="skeleton skeleton-panel" />
    </main>
  )
}

function LoginPage() {
  const [isRegister, setIsRegister] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const auth = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => isRegister
      ? api.register({ name, email, password })
      : api.login({ email, password }),
    onSuccess: ({ access_token, user }) => {
      auth.signIn(access_token, user)
      queryClient.setQueryData(['auth', 'me'], user)
      navigate('/', { replace: true })
    },
  })

  if (auth.token) return <Navigate to="/" replace />

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Team workspace</p>
        <h1>{isRegister ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted">Sign in to manage your team tasks.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <label>
              Name
              <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} />
            </label>
          )}
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={100} />
          </label>
          <label>
            Password
            <input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required />
            {isRegister && <small>Use 8–72 characters.</small>}
          </label>
          {mutation.isError && <ApiError error={mutation.error} />}
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Please wait...' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="auth-switch">
          {isRegister ? 'Already have an account?' : 'New to the workspace?'}{' '}
          <button type="button" className="text-button" onClick={() => { mutation.reset(); setIsRegister(!isRegister) }}>
            {isRegister ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </section>
    </main>
  )
}

function DashboardPage() {
  const { user, signOut } = useAuth()
  const queryClient = useQueryClient()
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const perPage = 8

  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: api.getDashboardSummary,
    refetchInterval: 10_000,
  })
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  })
  const tasksQuery = useQuery({
    queryKey: [...taskQueryKey, { page, perPage, status, search }],
    queryFn: () => api.getTasks({ page, per_page: perPage, status, search }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  })

  useEffect(() => {
    const lastPage = Math.max(1, tasksQuery.data?.pages ?? 1)
    if (page > lastPage) setPage(lastPage)
  }, [page, tasksQuery.data?.pages])

  const invalidateTaskData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] }),
    ])
  }

  const addMutation = useMutation({
    mutationFn: (payload: TaskInput) => api.createTask(payload),
    onSuccess: async () => {
      setTitle('')
      setDescription('')
      setPriority('medium')
      setAssignedTo('')
      setDueDate('')
      setPage(1)
      await invalidateTaskData()
    },
  })
  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: number; nextStatus: TaskStatus }) =>
      api.updateTask(id, { status: nextStatus }),
    onSuccess: invalidateTaskData,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTask(id),
    onSuccess: invalidateTaskData,
  })
  const passwordMutation = useMutation({
    mutationFn: () => api.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
  })

  const handleAddTask = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    addMutation.mutate({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      assigned_to: assignedTo ? Number(assignedTo) : null,
      due_date: dueDate || null,
    })
  }

  const handleChangePassword = (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      passwordMutation.reset()
      return
    }
    passwordMutation.mutate()
  }

  const summary = summaryQuery.data
  const anyQueryError = summaryQuery.isError || usersQuery.isError || tasksQuery.isError

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Team workspace</p>
          <h1>Task Dashboard</h1>
          <p className="muted">Welcome, {user?.name ?? 'team member'}</p>
        </div>
        <div className="topbar-actions">
          <span className="chip">TanStack Query</span>
          <button
            className="secondary-button"
            type="button"
            aria-expanded={showPasswordForm}
            onClick={() => {
              if (showPasswordForm) {
                setCurrentPassword('')
                setNewPassword('')
                setConfirmPassword('')
              }
              setShowPasswordForm((visible) => !visible)
              passwordMutation.reset()
            }}
          >
            {showPasswordForm ? 'Close password settings' : 'Change password'}
          </button>
          <button className="secondary-button" type="button" onClick={() => { signOut(); queryClient.clear() }}>
            Sign out
          </button>
        </div>
      </header>

      {showPasswordForm && (
        <section className="panel password-panel">
          <div className="section-heading">
            <div>
              <h2>Change password</h2>
              <p className="muted">Confirm your current password and choose a new one.</p>
            </div>
          </div>
          <form className="auth-form password-form" onSubmit={handleChangePassword}>
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value)
                  passwordMutation.reset()
                }}
                required
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  passwordMutation.reset()
                }}
                minLength={8}
                maxLength={72}
                required
              />
              <small>Use 8–72 characters.</small>
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  passwordMutation.reset()
                }}
                minLength={8}
                maxLength={72}
                required
              />
            </label>
            {newPassword !== confirmPassword && confirmPassword && (
              <div className="status-box error" role="alert">New passwords do not match.</div>
            )}
            {passwordMutation.isError && <ApiError error={passwordMutation.error} prefix="Could not change password" />}
            {passwordMutation.isSuccess && (
              <div className="status-box success" role="status">Password changed successfully.</div>
            )}
            <button type="submit" disabled={passwordMutation.isPending || newPassword !== confirmPassword}>
              {passwordMutation.isPending ? 'Updating...' : 'Update password'}
            </button>
          </form>
        </section>
      )}

      {anyQueryError && (
        <ApiError
          error={summaryQuery.error ?? usersQuery.error ?? tasksQuery.error}
          prefix="Some dashboard data could not be loaded"
        />
      )}

      <section className="stats-grid" aria-label="Task summary">
        {[
          { label: 'Total tasks', key: 'total' as const, color: 'blue' },
          { label: 'To do', key: 'todo' as const, color: 'blue' },
          { label: 'In progress', key: 'in_progress' as const, color: 'amber' },
          { label: 'Done', key: 'done' as const, color: 'green' },
          { label: 'High priority open', key: 'high_priority' as const, color: 'red' },
        ].map((item) => (
          <div key={item.key} className={`stat-card ${item.color}`}>
            <span>{item.label}</span>
            {summaryQuery.isLoading ? <div className="skeleton skeleton-number" /> : <strong>{summary?.[item.key] ?? '—'}</strong>}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Create a task</h2>
            <p className="muted">Changes refresh the task list and summary automatically.</p>
          </div>
        </div>
        <form className="task-form task-form-grid" onSubmit={handleAddTask}>
          <label className="form-wide">
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" maxLength={150} required />
          </label>
          <label className="form-wide">
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional details" />
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
              {priorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Assign to
            <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">Unassigned</option>
              {(usersQuery.data ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <button type="submit" disabled={addMutation.isPending || !title.trim()}>
            {addMutation.isPending ? 'Saving...' : 'Add task'}
          </button>
        </form>

        {addMutation.isError && <ApiError error={addMutation.error} prefix="Could not add task" />}
        {statusMutation.isError && <ApiError error={statusMutation.error} prefix="Could not update task" />}
        {deleteMutation.isError && <ApiError error={deleteMutation.error} prefix="Could not delete task" />}
      </section>

      <section className="panel">
        <div className="section-heading task-list-heading">
          <div>
            <h2>Tasks</h2>
            <p className="muted">
              {tasksQuery.data ? `${tasksQuery.data.total} task${tasksQuery.data.total === 1 ? '' : 's'}` : 'Loading tasks...'}
              {tasksQuery.isFetching && <span className="refresh-indicator"> · Refreshing</span>}
            </p>
          </div>
          <div className="task-filters">
            <input aria-label="Search tasks" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search tasks" />
            <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              <option value="all">All statuses</option>
              {statusOptions.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>

        {tasksQuery.isLoading ? (
          <div className="task-list" aria-label="Loading tasks">
            {[1, 2, 3].map((item) => <div className="skeleton skeleton-row" key={item} />)}
          </div>
        ) : tasksQuery.isError && !tasksQuery.data ? (
          <ApiError error={tasksQuery.error} prefix="Could not load tasks" />
        ) : tasksQuery.data?.items.length === 0 ? (
          <div className="status-box">No tasks match your filters.</div>
        ) : (
          <ul className="task-list">
            {(tasksQuery.data?.items ?? []).map((task) => (
              <li key={task.id} className="task-item">
                <div className="task-main">
                  <Link className="task-title task-link" to={`/tasks/${task.id}`}>{task.title}</Link>
                  <small>
                    {task.assigned_name ? `Assigned to ${task.assigned_name}` : 'Unassigned'}
                    {' · '}{task.priority} priority
                    {task.due_date ? ` · Due ${task.due_date}` : ''}
                  </small>
                </div>
                <div className="task-actions">
                  <select
                    value={task.status}
                    onChange={(event) => statusMutation.mutate({ id: task.id, nextStatus: event.target.value as TaskStatus })}
                    aria-label={`Update status for ${task.title}`}
                    disabled={statusMutation.isPending}
                  >
                    {statusOptions.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
                  </select>
                  <button className="danger" type="button" onClick={() => deleteMutation.mutate(task.id)} disabled={deleteMutation.isPending}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tasksQuery.data && tasksQuery.data.pages > 1 && (
          <nav className="pagination" aria-label="Task pages">
            <button type="button" className="secondary-button" disabled={page <= 1 || tasksQuery.isFetching} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>Page {tasksQuery.data.page} of {tasksQuery.data.pages}</span>
            <button type="button" className="secondary-button" disabled={page >= tasksQuery.data.pages || tasksQuery.isFetching} onClick={() => setPage((value) => value + 1)}>
              Next
            </button>
          </nav>
        )}
      </section>
    </main>
  )
}

function TaskDetailPage() {
  const { taskId } = useParams()
  const id = Number(taskId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const validId = Number.isInteger(id) && id > 0
  const taskQuery = useQuery({
    queryKey: [...taskQueryKey, 'detail', id],
    queryFn: () => api.getTask(id),
    enabled: validId,
  })
  const assigneeQuery = useQuery({
    queryKey: ['users', taskQuery.data?.assigned_to],
    queryFn: () => api.getUser(taskQuery.data!.assigned_to!),
    enabled: Boolean(taskQuery.data?.assigned_to),
  })
  const statusMutation = useMutation({
    mutationFn: (status: TaskStatus) => api.updateTask(id, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] }),
      ])
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTask(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] }),
      ])
      navigate('/', { replace: true })
    },
  })

  if (!validId) return <main className="app-shell"><ApiError error={new Error('Invalid task ID')} /></main>
  if (taskQuery.isLoading) return <LoadingPage label="Loading task..." />
  if (taskQuery.isError) return <main className="app-shell"><ApiError error={taskQuery.error} prefix="Could not load task" /><Link to="/">Back to dashboard</Link></main>
  const task = taskQuery.data
  if (!task) return null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Task details</p>
          <h1>{task.title}</h1>
        </div>
        <Link className="secondary-button link-button" to="/">Back to dashboard</Link>
      </header>
      <section className="panel detail-grid">
        <div><span className="detail-label">Description</span><p>{task.description || 'No description'}</p></div>
        <div><span className="detail-label">Priority</span><p className={`priority-${task.priority}`}>{task.priority}</p></div>
        <div><span className="detail-label">Assigned to</span><p>{task.assigned_to ? assigneeQuery.data?.name ?? 'Loading assignee…' : 'Unassigned'}</p></div>
        <div><span className="detail-label">Created by</span><p>{task.creator_name}</p></div>
        <div><span className="detail-label">Due date</span><p>{task.due_date ?? 'No due date'}</p></div>
        <div><span className="detail-label">Last updated</span><p>{new Date(task.updated_at).toLocaleString()}</p></div>
        <label>
          Status
          <select value={task.status} onChange={(event) => statusMutation.mutate(event.target.value as TaskStatus)} disabled={statusMutation.isPending}>
            {statusOptions.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
          </select>
        </label>
        <button className="danger" type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
          {deleteMutation.isPending ? 'Deleting...' : 'Delete task'}
        </button>
      </section>
      {assigneeQuery.isError && <ApiError error={assigneeQuery.error} prefix="Could not load assignee" />}
      {statusMutation.isError && <ApiError error={statusMutation.error} prefix="Could not update task" />}
      {deleteMutation.isError && <ApiError error={deleteMutation.error} prefix="Could not delete task" />}
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/tasks/:taskId" element={<RequireAuth><TaskDetailPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
