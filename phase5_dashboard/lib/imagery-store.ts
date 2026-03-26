// GROUNDLINK Imagery Metadata Store
// File-based JSON store for satellite imagery metadata (no DB needed)

import { readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { SatelliteImagery } from './types'

const STORE_PATH = path.join(process.cwd(), 'data', 'imagery-metadata.json')

async function readStore(): Promise<SatelliteImagery[]> {
  if (!existsSync(STORE_PATH)) {
    return []
  }
  const data = await readFile(STORE_PATH, 'utf-8')
  return JSON.parse(data)
}

async function writeStore(images: SatelliteImagery[]): Promise<void> {
  const tmpPath = STORE_PATH + '.tmp'
  await writeFile(tmpPath, JSON.stringify(images, null, 2), 'utf-8')
  await rename(tmpPath, STORE_PATH)
}

/**
 * List all images with optional filters
 */
export async function listImages(options?: {
  satellite?: string
  limit?: number
  offset?: number
}): Promise<{ images: SatelliteImagery[]; total: number }> {
  let images = await readStore()

  if (options?.satellite) {
    images = images.filter(img => img.satellite === options.satellite)
  }

  const total = images.length

  // Sort by capture date, newest first
  images.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())

  const offset = options?.offset || 0
  const limit = options?.limit || 50
  images = images.slice(offset, offset + limit)

  return { images, total }
}

/**
 * Get a single image by ID
 */
export async function getImage(id: string): Promise<SatelliteImagery | null> {
  const images = await readStore()
  return images.find(img => img.id === id) || null
}

/**
 * Add a new image entry
 */
export async function addImage(image: SatelliteImagery): Promise<void> {
  const images = await readStore()
  const existing = images.findIndex(img => img.id === image.id)
  if (existing >= 0) {
    images[existing] = image
  } else {
    images.push(image)
  }
  await writeStore(images)
}

/**
 * Update an existing image entry
 */
export async function updateImage(id: string, updates: Partial<SatelliteImagery>): Promise<SatelliteImagery | null> {
  const images = await readStore()
  const index = images.findIndex(img => img.id === id)
  if (index < 0) return null

  images[index] = { ...images[index], ...updates }
  await writeStore(images)
  return images[index]
}
