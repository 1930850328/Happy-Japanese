import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function readFixture(name: string) {
  const raw = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw) as unknown
}

test('slicer manifest parser keeps v1 compatible and validates v2 contract', async ({
  page,
}) => {
  const [v1, v2, invalidV2] = await Promise.all([
    readFixture('slicer-manifest-v1.json'),
    readFixture('slicer-manifest-v2.json'),
    readFixture('slicer-manifest-invalid-v2.json'),
  ])

  await page.goto('/')

  const result = await page.evaluate(
    async ({ v1Manifest, v2Manifest, invalidV2Manifest }) => {
      const {
        getManifestQualityTags,
        parseSlicerManifestData,
      } = await import('/src/lib/slicerManifest.ts')
      const normalizedV1 = parseSlicerManifestData(v1Manifest)
      const normalizedV2 = parseSlicerManifestData(v2Manifest)
      let invalidMessage = ''

      try {
        parseSlicerManifestData(invalidV2Manifest)
      } catch (error) {
        invalidMessage = error instanceof Error ? error.message : String(error)
      }

      return {
        v1Version: normalizedV1.version,
        v1SubtitleSource: normalizedV1.subtitleSource,
        v2Version: normalizedV2.version,
        v2Engine: normalizedV2.pipeline?.engine,
        v2Warning: normalizedV2.clips[0].qualityWarnings[0],
        v2Tags: getManifestQualityTags(normalizedV2.clips[0]),
        invalidMessage,
      }
    },
    { v1Manifest: v1, v2Manifest: v2, invalidV2Manifest: invalidV2 },
  )

  expect(result.v1Version).toBe(1)
  expect(result.v1SubtitleSource).toBe('external')
  expect(result.v2Version).toBe(2)
  expect(result.v2Engine).toBe('anime-learning-slicer')
  expect(result.v2Warning).toBe('Scene boundary is approximate.')
  expect(result.v2Tags).toContain('需要复核')
  expect(result.v2Tags).toContain('切片警告: Scene boundary is approximate.')
  expect(result.invalidMessage).toContain('clips[0].videoPath')
  expect(result.invalidMessage).toContain('clips[0].subtitlePath')
  expect(result.invalidMessage).toContain('clips[0].quality')
  expect(result.invalidMessage).toContain('clips[0].segments[0].startMs')
})
