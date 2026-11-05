export type Etapa = 'plano' | 'construcao' | 'backup' | 'publicado'

export type Pendencia = { id: string; texto: string; feita: boolean; criada: number }

export type Acontecimento = { t: number; texto: string }

/** O que o painel guarda de cada projeto (pasta), entre sessões. */
export type Projeto = {
  /** Quando cada etapa aconteceu pela última vez (ms). */
  marcas: { plano?: number; construcao?: number; backup?: number; publicado?: number }
  pendencias: Pendencia[]
  minutosTotal: number
  dia: string
  minutosHoje: number
  linkApp: string
  historico: Acontecimento[]
}

export type GitInfo = {
  temGit: boolean
  branch: string
  alterados: number
  ultimoCommit: { msg: string; t: number } | null
  remoto: string
  temUpstream: boolean
  aFrente: number
}

/** Tudo que o painel desenha, lido de uma vez. */
export type Retrato = {
  pasta: string
  nome: string
  projeto: Projeto
  git: GitInfo
  temPlano: boolean
  temCodigo: boolean
  valorHora: number
  lidoEm: number
}

declare module 'claude-code' {
  interface PluginState {
    'painel-projeto': {
      retrato: Shaped<Retrato | null>
      ajustes: { editarValor: boolean; editarLink: boolean }
    }
  }
}
