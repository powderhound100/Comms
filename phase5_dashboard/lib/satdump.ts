// GROUNDLINK SatDump CLI Wrapper
// Wraps child_process.execFile calls to SatDump for post-capture decoding

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { SatDumpConfig } from './types'

const execFileAsync = promisify(execFile)

// Platform-aware SatDump command path
const SATDUMP_CMD = process.platform === 'win32'
  ? 'C:/Program Files/SatDump/satdump.exe'
  : 'satdump'

export interface SatDumpJobResult {
  success: boolean
  outputDir: string
  decodedFiles: string[]
  stdout: string
  stderr: string
  durationMs: number
}

export interface SatDumpProgress {
  percentage: number
  stage: string
  message: string
}

/**
 * Execute a SatDump pipeline on an IQ recording
 */
export async function runSatDump(options: {
  config: SatDumpConfig
  inputFile: string
  outputDir: string
  extraArgs?: string[]
}): Promise<SatDumpJobResult> {
  const { config, inputFile, outputDir, extraArgs = [] } = options

  const args = [
    config.pipelineName,
    config.inputFormat,
    inputFile,
    outputDir,
    '--samplerate', String(config.sampleRate),
    ...extraArgs,
  ]

  const startTime = Date.now()

  try {
    const { stdout, stderr } = await execFileAsync(SATDUMP_CMD, args, {
      timeout: 600000, // 10 minute timeout
      maxBuffer: 10 * 1024 * 1024,
    })

    const decodedFiles = parseSatDumpOutput(stdout)

    return {
      success: true,
      outputDir,
      decodedFiles,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
    }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return {
      success: false,
      outputDir,
      decodedFiles: [],
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || 'Unknown error',
      durationMs: Date.now() - startTime,
    }
  }
}

/**
 * Parse SatDump stdout to extract decoded file paths and progress info
 */
export function parseSatDumpOutput(stdout: string): string[] {
  const files: string[] = []
  const lines = stdout.split('\n')

  for (const line of lines) {
    // SatDump outputs lines like "Saved <path>" or "Writing <path>"
    const savedMatch = line.match(/(?:Saved|Writing|Output)\s+(.+\.(?:png|jpg|bmp|tif|raw))/)
    if (savedMatch) {
      files.push(savedMatch[1].trim())
    }
  }

  return files
}

/**
 * Parse progress updates from SatDump output
 */
export function parseSatDumpProgress(line: string): SatDumpProgress | null {
  // SatDump progress lines look like: "[XX%] Stage: message"
  const progressMatch = line.match(/\[(\d+)%\]\s*(.+?):\s*(.+)/)
  if (progressMatch) {
    return {
      percentage: parseInt(progressMatch[1], 10),
      stage: progressMatch[2].trim(),
      message: progressMatch[3].trim(),
    }
  }
  return null
}

/**
 * Build CLI command string for display purposes
 */
export function buildSatDumpCommand(config: SatDumpConfig, inputFile: string, outputDir: string): string {
  return `satdump ${config.pipelineName} ${config.inputFormat} ${inputFile} ${outputDir} --samplerate ${config.sampleRate}`
}
