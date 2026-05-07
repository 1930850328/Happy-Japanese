import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

export function makeOutputLayout({ appDir, slug, outputDir }) {
  const publicRoot = resolve(appDir, 'public')
  const generatedRoot = resolve(publicRoot, 'generated-slices')
  const root = outputDir ? resolve(outputDir) : resolve(generatedRoot, slug)

  return {
    root,
    clipsDir: resolve(root, 'clips'),
    coversDir: resolve(root, 'covers'),
    subtitlesDir: resolve(root, 'subtitles'),
    metadataDir: resolve(root, 'metadata'),
    manifestPath: resolve(root, 'manifest.json'),
    reportPath: resolve(root, 'report.json'),
    indexPath: resolve(generatedRoot, 'index.json'),
    publicRoot,
    generatedRoot,
  }
}

export function publicPath(filePath, publicRoot) {
  return `/${relative(publicRoot, filePath).split(/[\\/]/).join('/')}`
}

export async function ensureLayout(layout) {
  await Promise.all([
    mkdir(layout.clipsDir, { recursive: true }),
    mkdir(layout.coversDir, { recursive: true }),
    mkdir(layout.subtitlesDir, { recursive: true }),
    mkdir(layout.metadataDir, { recursive: true }),
    mkdir(dirname(layout.indexPath), { recursive: true }),
  ])
}

export async function writeJson(pathValue, data) {
  await mkdir(dirname(pathValue), { recursive: true })
  await writeFile(pathValue, `${JSON.stringify(data, null, 2)}\n`)
}

export async function updateGeneratedIndex(layout, entry) {
  let existing = []
  try {
    const raw = await readFile(layout.indexPath, 'utf8')
    const parsed = JSON.parse(raw)
    existing = Array.isArray(parsed) ? parsed : []
  } catch {
    existing = []
  }

  const next = [entry, ...existing.filter((item) => item.slug !== entry.slug)]
  await writeJson(layout.indexPath, next)
}

export function joinOutput(...parts) {
  return join(...parts)
}
