// Funcionários (migration 0048): Configurações → Funcionários. É a lista do
// "Quem é você?" no link /oc e do Solicitante da Ordem de Compra.

export interface Funcionario {
  id: string
  nome: string
  centro_custo: string | null
  ativo: boolean
}
