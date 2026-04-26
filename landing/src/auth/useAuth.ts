import { useState, useCallback } from 'react'

export interface User {
  id: string
  phone: string
  rol: string
  nombre: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('wasagro_user')
    return saved ? JSON.parse(saved) : null
  })

  const login = useCallback((userData: User) => {
    setUser(userData)
    localStorage.setItem('wasagro_user', JSON.stringify(userData))
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem('wasagro_user')
  }, [])

  return {
    user,
    isAuthenticated: !!user,
    login,
    logout
  }
}
