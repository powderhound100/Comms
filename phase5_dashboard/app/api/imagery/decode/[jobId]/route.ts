// GET /api/imagery/decode/[jobId] — Check decode job status/progress
import { NextRequest, NextResponse } from 'next/server'
import { jobs } from '@/lib/decode-jobs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  const job = jobs.get(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({
    jobId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    ...(job.status !== 'running' ? { result: job.result } : {}),
  })
}
