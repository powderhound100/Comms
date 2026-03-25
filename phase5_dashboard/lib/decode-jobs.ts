// In-memory decode job tracking (would use a proper queue in production)

export interface DecodeJob {
  status: 'running' | 'complete' | 'failed'
  progress: number
  result?: unknown
  startedAt: string
}

export const jobs = new Map<string, DecodeJob>()
