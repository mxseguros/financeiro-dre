'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Exportar virou a janela do botão Exportar da barra do topo (redesenho UX, fase 8). */
export default function ExportsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/dre?exportar=1') }, [router])
  return null
}
