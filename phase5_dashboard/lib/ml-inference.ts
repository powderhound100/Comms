// GROUNDLINK ML Inference Bridge
// Calls Phase 6 Python inference scripts via child_process

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { ClassificationResult } from './types'

const execFileAsync = promisify(execFile)

const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3'
const INFER_SCRIPT = path.join(process.cwd(), '..', 'phase6_signal_recognition', 'scripts', 'infer.py')

export interface InferenceInput {
  iqData: number[][] // shape (2, N) — I and Q channels
  frequencyMhz: number
  bandwidthKhz: number
  model?: 'vtcnn2' | 'resnet1d'
}

export interface InferenceOutput {
  predictions: { modulation: string; confidence: number }[]
  inferenceTimeMs: number
  modelUsed: string
}

/**
 * Run ML classification on IQ data
 */
export async function classify(input: InferenceInput): Promise<InferenceOutput> {
  const model = input.model || 'vtcnn2'

  // Write IQ data to temp file
  const tmpFile = path.join(os.tmpdir(), `groundlink_iq_${Date.now()}.json`)
  await writeFile(tmpFile, JSON.stringify({
    iq_data: input.iqData,
    frequency_mhz: input.frequencyMhz,
    bandwidth_khz: input.bandwidthKhz,
  }), 'utf-8')

  try {
    const { stdout } = await execFileAsync(PYTHON_CMD, [
      INFER_SCRIPT,
      '--input', tmpFile,
      '--model', model,
      '--format', 'json',
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })

    const result = JSON.parse(stdout.trim())

    return {
      predictions: result.predictions || [],
      inferenceTimeMs: result.inference_time_ms || 0,
      modelUsed: result.model_used || model,
    }
  } catch (error: unknown) {
    const err = error as { message?: string }
    throw new Error(`ML inference failed: ${err.message || 'Unknown error'}`)
  } finally {
    // Clean up temp file
    try {
      await unlink(tmpFile)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Build a ClassificationResult from inference output
 */
export function toClassificationResult(
  input: InferenceInput,
  output: InferenceOutput
): ClassificationResult {
  const topPrediction = output.predictions[0]
  return {
    timestamp: new Date().toISOString(),
    frequencyMhz: input.frequencyMhz,
    bandwidthKhz: input.bandwidthKhz,
    modulationType: topPrediction?.modulation || 'unknown',
    confidence: topPrediction?.confidence || 0,
    snrDb: 0, // Would be measured from IQ data
    modelUsed: output.modelUsed,
    inferenceTimeMs: output.inferenceTimeMs,
  }
}
