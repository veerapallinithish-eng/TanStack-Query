import axios from 'axios'

export const authStorageKey = 'task-manager-auth'

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export type User = {
  id: number
  name: string
  email: string
  role: 'admin' | 'member'
  created_at: string | null
}

export type Task = {
  id: number
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigned_to: number | null
  created_by: number
  due_date: string | null
  created_at: string
  updated_at: string
  assigned_name: string | null
  creator_name: string
}

export type TaskInput = Pick<Task, 'title'> &
  Partial<Pick<Task, 'description' | 'status' | 'priority' | 'assigned_to' | 'due_date'>>

export type TaskPage = {
  items: Task[]
  page: number
  per_page: number
  total: number
  pages: number
}

export type DashboardSummary = {
  total: number
  todo: number
  in_progress: number
  done: number
  high_priority: number
}

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error ?? error.message
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

const apiClient = axios.create({ baseURL: '/api' })

apiClient.interceptors.request.use((config) => {
  const storedAuth = localStorage.getItem(authStorageKey)
  if (storedAuth) {
    const auth = JSON.parse(storedAuth) as { token?: string }
    if (auth.token) config.headers.Authorization = `Bearer ${auth.token}`
  }
  return config
})

export const api = {
  login: async (payload: { email: string; password: string }) => {
    const response = await apiClient.post<{ access_token: string; user: User }>('/auth/login', payload)
    return response.data
  },
  changePassword: async (payload: { current_password: string; new_password: string }) => {
    const response = await apiClient.post<{ message: string }>('/auth/change-password', payload)
    return response.data
  },
  register: async (payload: { name: string; email: string; password: string }) => {
    const response = await apiClient.post<{ access_token: string; user: User }>('/auth/register', payload)
    return response.data
  },
  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get('/auth/me')
    return response.data
  },
  getUsers: async (): Promise<User[]> => {
    const response = await apiClient.get('/users')
    return response.data
  },
  getUser: async (id: number): Promise<User> => {
    const response = await apiClient.get(`/users/${id}`)
    return response.data
  },
  getDashboardSummary: async (): Promise<DashboardSummary> => {
    const response = await apiClient.get('/dashboard/summary')
    return response.data
  },
  getTasks: async (params: { page: number; per_page: number; status: string; search: string }): Promise<TaskPage> => {
    const response = await apiClient.get('/tasks', { params })
    return response.data
  },
  getTask: async (id: number): Promise<Task> => {
    const response = await apiClient.get(`/tasks/${id}`)
    return response.data
  },
  createTask: async (payload: TaskInput): Promise<Task> => {
    const response = await apiClient.post('/tasks', payload)
    return response.data
  },
  updateTask: async (id: number, payload: Partial<TaskInput>): Promise<Task> => {
    const response = await apiClient.put(`/tasks/${id}`, payload)
    return response.data
  },
  deleteTask: async (id: number) => {
    const response = await apiClient.delete(`/tasks/${id}`)
    return response.data
  },
}
