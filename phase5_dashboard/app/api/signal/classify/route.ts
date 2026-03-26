// POST /api/signal/classify — Run ML classification on IQ data
import { NextRequest, NextResponse } from 'next/server'
import { classify, toClassificationResult, InferenceInput } from '@/lib/ml-inference'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { iqData, frequencyMhz, bandwidthKhz, model } = body as InferenceInput

    if (!iqData || !frequencyMhz) {
      return NextResponse.json(
        { error: 'Missing required fields: iqData, frequencyMhz' },
        { status: 400 }
      )
    }

    // Validate IQ data shape
    if (!Array.isArray(iqData) || iqData.length !== 2) {
      return NextResponse.json(
        { error: 'iqData must be shape (2, N) — I and Q channels' },
        { status: 400 }
      )
    }

    const input: InferenceInput = {
      iqData,
      frequencyMhz,
      bandwidthKhz: bandwidthKhz || 0,
      model: model || 'vtcnn2',
    }

    const output = await classify(input)
    const result = toClassificationResult(input, output)

    return NextResponse.json({
      classification: result,
      predictions: output.predictions,
      inferenceTimeMs: output.inferenceTimeMs,
      modelUsed: output.modelUsed,
    })
  } catch (error: unknown) {
    const err = error as { message?: string }
    return NextResponse.json(
      { error: err.message || 'Classification failed' },
      { status: 500 }
    )
  }
}
