import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function readFixture(name: string) {
  const raw = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw) as unknown
}

test('slicer manifest parser keeps v1 compatible and validates v2 contract', async ({
  page,
}) => {
  const [v1, v2, invalidV2, lowQualityV2] = await Promise.all([
    readFixture('slicer-manifest-v1.json'),
    readFixture('slicer-manifest-v2.json'),
    readFixture('slicer-manifest-invalid-v2.json'),
    readFixture('slicer-manifest-low-quality-v2.json'),
  ])

  await page.goto('/')

  const result = await page.evaluate(
    async ({ v1Manifest, v2Manifest, invalidV2Manifest, lowQualityV2Manifest }) => {
      const {
        getMissingManifestAssetMessages,
        getManifestQualityTags,
        parseSlicerManifestData,
      } = await import('/src/lib/slicerManifest.ts')
      const { useAppStore } = await import('/src/store/useAppStore.ts')
      const normalizedV1 = parseSlicerManifestData(v1Manifest)
      const normalizedV2 = parseSlicerManifestData(v2Manifest)
      let v1ImportMessage = ''
      let invalidMessage = ''
      let lowQualityMessage = ''

      try {
        await useAppStore.getState().importSlicerManifest({
          manifestFile: new File([JSON.stringify(v1Manifest)], 'manifest.json', {
            type: 'application/json',
          }),
          clipFiles: [],
        })
      } catch (error) {
        v1ImportMessage = error instanceof Error ? error.message : String(error)
      }
      try {
        parseSlicerManifestData(invalidV2Manifest)
      } catch (error) {
        invalidMessage = error instanceof Error ? error.message : String(error)
      }
      try {
        parseSlicerManifestData(lowQualityV2Manifest)
      } catch (error) {
        lowQualityMessage = error instanceof Error ? error.message : String(error)
      }

      return {
        v1Version: normalizedV1.version,
        v1SubtitleSource: normalizedV1.subtitleSource,
        v2Version: normalizedV2.version,
        v2Engine: normalizedV2.pipeline?.engine,
        v2Warnings: normalizedV2.clips[0].qualityWarnings,
        v2Tags: getManifestQualityTags(normalizedV2.clips[0]),
        completeAssetMessages: getMissingManifestAssetMessages(normalizedV2, [
          new File(['video'], 'fixture-ep01-000800-002400.mp4', { type: 'video/mp4' }),
          new File(['cover'], 'fixture-ep01-000800-002400.jpg', { type: 'image/jpeg' }),
          new File(['WEBVTT'], 'fixture-ep01-000800-002400.vtt', { type: 'text/vtt' }),
        ]),
        missingAssetMessages: getMissingManifestAssetMessages(normalizedV2, [
          new File(['video'], 'fixture-ep01-000800-002400.mp4', { type: 'video/mp4' }),
        ]),
        v1ImportMessage,
        invalidMessage,
        lowQualityMessage,
      }
    },
    { v1Manifest: v1, v2Manifest: v2, invalidV2Manifest: invalidV2, lowQualityV2Manifest: lowQualityV2 },
  )

  expect(result.v1Version).toBe(1)
  expect(result.v1SubtitleSource).toBe('external')
  expect(result.v1ImportMessage).toContain('manifest v2')
  expect(result.v2Version).toBe(2)
  expect(result.v2Engine).toBe('anime-learning-slicer')
  expect(result.v2Warnings).toEqual([])
  expect(result.v2Tags).toEqual([])
  expect(result.completeAssetMessages).toEqual([])
  expect(result.missingAssetMessages).toContain(
    'clips[0].coverPath asset is missing: covers/fixture-ep01-000800-002400.jpg',
  )
  expect(result.missingAssetMessages).toContain(
    'clips[0].subtitlePath asset is missing: subtitles/fixture-ep01-000800-002400.vtt',
  )
  expect(result.invalidMessage).toContain('clips[0].videoPath')
  expect(result.invalidMessage).toContain('clips[0].coverPath')
  expect(result.invalidMessage).toContain('clips[0].subtitlePath')
  expect(result.invalidMessage).toContain('clips[0].quality')
  expect(result.invalidMessage).toContain('clips[0].knowledgePoints')
  expect(result.invalidMessage).toContain('clips[0].segments[0].startMs')
  expect(result.invalidMessage).toContain('clips[0].segments focusTermIds')
  expect(result.lowQualityMessage).toContain('clips[0].quality.needsReview must be false')
  expect(result.lowQualityMessage).toContain('clips[0].quality.warnings must be empty')
  expect(result.lowQualityMessage).toContain('clips[0].quality.asrConfidence')
  expect(result.lowQualityMessage).toContain('clips[0].quality.alignmentConfidence')
})
