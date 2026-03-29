import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const inputDir = resolve(root, 'content')
const outputDir = resolve(root, 'src', 'generated')

async function prepare() {
  await mkdir(outputDir, { recursive: true })

  const files = ['video-lessons.json', 'vocab-cards.json', 'sources.json']

  for (const file of files) {
    try {
      const raw = await readFile(resolve(inputDir, file), 'utf8')
      const parsed = JSON.parse(raw)
      const minified = JSON.stringify(parsed, null, 2)
      await writeFile(resolve(outputDir, file), minified)
      console.log(`Prepared ${file}`)
    } catch {
      console.log(`Skip ${file} (source file not found)`)
    }
  }
}

prepare().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
