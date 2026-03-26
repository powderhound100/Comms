// POST /api/imagery/decode — Trigger SatDump decode job
import { NextRequest, NextResponse } from 'next/server'
import { runSatDump } from '@/lib/satdump'
import { addImage } from '@/lib/imagery-store'
import { SatDumpConfig, SatelliteImagery } from '@/lib/types'
import { jobs } from '@/lib/decode-jobs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { inputFile, outputDir, config } = body as {
      inputFile: string
      outputDir: string
      config: SatDumpConfig
    }

    if (!inputFile || !outputDir || !config) {
      return NextResponse.json(
        { error: 'Missing required fields: inputFile, outputDir, config' },
        { status: 400 }
      )
    }

    const jobId = `decode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Track job
    jobs.set(jobId, {
      status: 'running',
      progress: 0,
      startedAt: new Date().toISOString(),
    })

    // Run decode asynchronously
    runSatDump({ config, inputFile, outputDir }).then(async (result) => {
      const job = jobs.get(jobId)
      if (!job) return

      if (result.success) {
        job.status = 'complete'
        job.progress = 100
        job.result = result

        // Create imagery entry
        const imageEntry: SatelliteImagery = {
          id: jobId,
          satellite: config.satellite,
          captureType: config.pipelineName.includes('lrit') ? 'LRIT' :
                       config.pipelineName.includes('lrpt') ? 'LRPT' : 'APT',
          capturedAt: new Date().toISOString(),
          imagePaths: result.decodedFiles,
          thumbnailPath: result.decodedFiles[0] || '',
          channels: [],
          decodeStatus: 'complete',
          signalQuality: { snrDb: 0, cn0Dbhz: 0, lockPercentage: 0, viterbiBer: 0, rsErrors: 0 },
        }
        await addImage(imageEntry)
      } else {
        job.status = 'failed'
        job.result = { error: result.stderr }
      }
    })

    return NextResponse.json({ jobId, status: 'running' }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'Failed to start decode job' }, { status: 500 })
  }
}
