export type SessionRow = {
  id: string
  title: string
  ai_title: string
  first: string
  last: string
  cwd: string
  place: string
  branch: string
  ago: string
  status: '' | 'busy' | 'idle' | string
  /** 起動中のときのプロセスの種類: 'bg' (デーモン上)、'interactive' など */
  kind?: string
  turns: number
}

export type Proposal = {
  id: string
  old: string
  title: string
  skip: boolean
  /** 別プロセスで起動中 (外から書くと agent-name が書き戻される) */
  live: boolean
}

declare module 'claude-code' {
  interface PluginState {
    sessions: {
      rows: SessionRow[]
      query: string
      page: number
      proposals: Proposal[]
      note: string
    }
  }
}
