'use client'
import { createContext, useContext } from 'react'
import type { Role, Permissions } from '@/types'

export interface UserContextValue {
  /** id do auth.users — compara com `criado_por` para saber o que é do usuário. */
  userId: string | null
  role: Role | null
  nome: string
  email: string
  permissions: Permissions | null
}

const UserContext = createContext<UserContextValue>({ userId: null, role: null, nome: '', email: '', permissions: null })

export function useUser() {
  return useContext(UserContext)
}

export { UserContext }
