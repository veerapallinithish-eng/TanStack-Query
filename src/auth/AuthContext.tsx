import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { authStorageKey, type User } from '../api/api'

type AuthValue = {
  token: string | null
  user: User | null
  signIn: (token: string, user: User) => void
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function readStoredAuth(): { token: string | null; user: User | null } {
  try {
    const stored = localStorage.getItem(authStorageKey)
    if (!stored) return { token: null, user: null }
    const parsed = JSON.parse(stored) as { token?: string; user?: User }
    return { token: parsed.token ?? null, user: parsed.user ?? null }
  } catch {
    localStorage.removeItem(authStorageKey)
    return { token: null, user: null }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState(readStoredAuth)

  const value = useMemo<AuthValue>(() => ({
    ...auth,
    signIn: (token, user) => {
      localStorage.setItem(authStorageKey, JSON.stringify({ token, user }))
      setAuth({ token, user })
    },
    signOut: () => {
      localStorage.removeItem(authStorageKey)
      setAuth({ token: null, user: null })
    },
  }), [auth])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
