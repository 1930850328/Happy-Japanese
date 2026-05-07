# Slicing Pipeline Upgrade Plan

## Goal

Build a maintainable, AI-friendly, and extensible video slicing pipeline for Japanese learning clips.

The current browser-only flow is useful for quick previews, but it is not reliable enough for high-quality slicing. The upgraded pipeline should produce real short video files, accurate subtitle timing, cleaner Japanese learning metadata, and a stable manifest that this app can import.

## Current State

The app currently has two ingestion paths:

- Page preview flow: `src/pages/ProfilePage.tsx` runs browser-side video compatibility checks, subtitle parsing or browser ASR, knowledge extraction, and candidate slicing.
- External slicer flow: `scripts/ingest-video.mjs` and `scripts/watch-video-inbox.mjs` call a sibling `anime-learning-slicer` repo, then import `manifest.json + clips` through `src/lib/slicerManifest.ts`.

The page preview flow does not physically cut videos. It uploads one source video and stores each slice as a `clipStartMs` / `clipEndMs` playback window.

## Decision

Move production-quality slicing out of the browser and into a deterministic slicer engine. Keep the browser flow as a lightweight preview and fallback only.

The production path should be:

1. User or watcher submits a source video and optional subtitle/metadata.
2. Slicer engine extracts media, subtitles, scenes, speech regions, and learning metadata.
3. Slicer engine writes real clip files, cover images, subtitle files, metadata files, and one manifest.
4. This app imports the manifest through the existing advanced import path.

This can be implemented first as the existing sibling CLI `anime-learning-slicer`, then optionally exposed as a local or hosted worker service later.

## Architecture

```text
Happy-Japanese app
  |
  | upload/import request
  v
Slicer adapter
  |
  | job input
  v
Slicer engine
  |
  | media probe -> subtitle acquisition -> alignment -> boundary detection
  | -> Japanese NLP -> candidate scoring -> physical clipping -> QA
  v
Slicer manifest v2 + assets
  |
  | import
  v
Happy-Japanese feed
```

## Module Boundaries

### App layer

Owned by this repository.

Responsibilities:

- Collect video, subtitle, title, episode, and slicing preferences.
- Show task status and imported clip results.
- Import manifest assets into current `ImportedClip` / `VideoLesson` models.
- Keep browser preview available for small files and debugging.

Non-responsibilities:

- Running Whisper, OCR, scene detection, or heavy ffmpeg jobs in the main app runtime.
- Making final production slice decisions with frontend-only heuristics.

### Slicer adapter

Owned by this repository or a small package shared with the slicer engine.

Responsibilities:

- Start a CLI or worker job.
- Track job status.
- Validate manifest schema before import.
- Map slicer errors into user-readable messages.

### Slicer engine

Can live in `anime-learning-slicer`, `server/slicer`, or a separate worker service.

Responsibilities:

- Produce deterministic artifacts.
- Expose clear stage outputs for debugging and AI review.
- Support pluggable backends for ASR, OCR, NLP, and scoring.

## Recommended Open Source Stack

### Media probe and clipping

Use native FFmpeg for server/CLI processing.

- Purpose: probe duration, streams, codecs, subtitle tracks; extract audio; cut final mp4 clips; create cover frames.
- Reason: stable, widely used, and already fits the existing slicer CLI model.
- Browser fallback: use `ffmpeg.wasm` only for small local previews. Consider `Mediabunny` later for WebCodecs-based trimming and metadata operations.

### ASR and timing

Use WhisperX as the preferred production ASR path.

- Base ASR: `faster-whisper`.
- Alignment: WhisperX word-level alignment.
- VAD: WhisperX / Silero VAD.
- Optional diarization: pyannote.audio when speaker turns matter.

Fallback:

- `faster-whisper` only, when GPU or alignment models are unavailable.

### Subtitle synchronization

Use `ffsubsync` when an external subtitle exists but timing may not match the video.

Input cases:

- User-provided `.srt`, `.vtt`, or `.ass`.
- Extracted embedded subtitle streams.

Output:

- Synced subtitle cues with confidence metadata.

### Hard subtitle OCR

Do not continue expanding custom browser OCR heuristics.

Preferred options:

- `VideOCR` for hardcoded subtitle extraction with PaddleOCR.
- `RapidVideOCR` or VideoSubFinder + OCR for CLI-oriented batch extraction.
- `EasyOCR` as a Python OCR fallback for Japanese/Chinese subtitle text.

The slicer should keep OCR as an optional stage. ASR should remain the default when audio is clear, because hardsub OCR is sensitive to font, crop, background, and language mix.

### Scene and speech boundaries

Use:

- `PySceneDetect` for visual scene boundaries.
- Silero VAD or pyannote.audio for speech/silence regions.

Boundary selection should combine:

- Subtitle sentence boundaries.
- Speech pauses.
- Scene boundaries.
- Min/max duration constraints.
- Context padding.

### Japanese NLP

Replace browser-only `kuromoji` as the production NLP engine.

Preferred:

- Sudachi / SudachiPy / sudachi.rs for Japanese morphological analysis, normalized forms, readings, and multi-granularity segmentation.

Optional enrichment:

- JMdict/JMnedict for dictionary meanings and readings.
- A maintained grammar-pattern dataset for N5-N1 style grammar tags.
- BudouX for phrase grouping and display-friendly line breaks.

## Manifest Contract

Keep the app-facing contract stable and explicit. Introduce a manifest v2 while remaining backward compatible with the current `SlicerManifestData`.

### Compatibility Rules

- Manifest v1 remains the compatibility format for existing slicer outputs that do not include a `version` field.
- Manifest v2 is the production slicer contract. It must include `version: 2`, pipeline provenance, physical clip asset paths, and quality metadata.
- The app importer should normalize v1 and v2 into one app-facing shape before creating `ImportedClip` records.
- Unknown top-level fields and unknown clip fields should be preserved only in debug logs or future metadata, not used for playback decisions.
- Invalid required fields should produce actionable errors that name the failing field path, for example `clips[3].videoPath`.

### Required top-level fields

```json
{
  "version": 2,
  "animeTitle": "Bocchi the Rock!",
  "episodeTitle": "EP01",
  "sourceVideo": "episode01.mkv",
  "generatedAt": "2026-05-06T00:00:00.000Z",
  "pipeline": {
    "engine": "anime-learning-slicer",
    "engineVersion": "0.1.0",
    "asr": "whisperx-large-v3",
    "alignment": "whisperx",
    "sceneDetector": "pyscenedetect-content",
    "nlp": "sudachi"
  },
  "clips": []
}
```

### Required clip fields

Each clip should contain:

- `id`: stable deterministic id, preferably based on anime, episode, start/end, and source hash.
- `clipTitle`: user-facing title.
- `startMs` / `endMs` / `durationMs`: source-video timing.
- `videoPath`: physically cut clip file path.
- `coverPath`: generated cover image.
- `subtitlePath`: clip subtitle file, preferably `.vtt`.
- `transcriptJa` / `transcriptZh`: joined text for preview/search.
- `segments`: normalized clip-local transcript segments starting near `0`.
- `knowledgePoints`: words, grammar, and phrases tied to segment focus ids.
- `quality`: debug and confidence fields.

Each segment should contain clip-local timing:

```json
{
  "startMs": 0,
  "endMs": 2800,
  "ja": "少し待ってみよう。",
  "kana": "すこしまってみよう。",
  "romaji": "sukoshi matte miyou.",
  "zh": "先稍微等一下看看吧。",
  "focusTermIds": ["grammar-te-miru"]
}
```

Timing rule:

- `clip.startMs` / `clip.endMs` refer to the original source video.
- `segment.startMs` / `segment.endMs` refer to the generated clip file, starting near `0`.
- Importers should reject negative segment timings and segments that run far past `clip.durationMs`.

Recommended `quality` shape:

```json
{
  "asrConfidence": 0.86,
  "alignmentConfidence": 0.78,
  "ocrConfidence": null,
  "sceneBoundaryStart": true,
  "sceneBoundaryEnd": false,
  "speechBoundaryStart": true,
  "speechBoundaryEnd": true,
  "needsReview": false,
  "warnings": []
}
```

Quality handling:

- `needsReview: true` must remain visible after import, either as a tag or an import warning.
- `warnings` should be preserved in app metadata or tags until a richer report view exists.
- Confidence fields are advisory. A missing confidence should not fail import unless the field is required by the manifest version.
- Clips with fatal media issues should not be emitted as accepted clips; they belong in `report.json` rejected candidate reasons.

### Minimal v2 Fixture

Use this shape for the first schema fixture. The actual fixture can be shorter, but it should include one warning so the warning preservation path is tested.

```json
{
  "version": 2,
  "animeTitle": "Fixture Anime",
  "episodeTitle": "EP01",
  "sourceVideo": "fixture-episode.mp4",
  "generatedAt": "2026-05-06T00:00:00.000Z",
  "pipeline": {
    "engine": "anime-learning-slicer",
    "engineVersion": "0.1.0",
    "asr": "external-subtitle",
    "alignment": "ffsubsync",
    "sceneDetector": "pyscenedetect-content",
    "nlp": "sudachi"
  },
  "clips": [
    {
      "id": "fixture-ep01-000800-002400",
      "clipTitle": "少し待ってみよう",
      "startMs": 8000,
      "endMs": 24000,
      "durationMs": 16000,
      "videoPath": "clips/fixture-ep01-000800-002400.mp4",
      "coverPath": "covers/fixture-ep01-000800-002400.jpg",
      "subtitlePath": "subtitles/fixture-ep01-000800-002400.vtt",
      "transcriptJa": "少し待ってみよう。",
      "transcriptZh": "先稍微等一下看看吧。",
      "segments": [
        {
          "startMs": 0,
          "endMs": 2800,
          "ja": "少し待ってみよう。",
          "kana": "すこしまってみよう。",
          "romaji": "sukoshi matte miyou.",
          "zh": "先稍微等一下看看吧。",
          "focusTermIds": ["grammar-te-miru"]
        }
      ],
      "knowledgePoints": [
        {
          "id": "grammar-te-miru",
          "kind": "grammar",
          "expression": "てみる",
          "reading": "てみる",
          "meaningZh": "试着做",
          "partOfSpeech": "grammar",
          "explanationZh": "表示尝试做某事。",
          "exampleJa": "少し待ってみよう。",
          "exampleZh": "先稍微等一下看看吧。"
        }
      ],
      "quality": {
        "asrConfidence": null,
        "alignmentConfidence": 0.91,
        "ocrConfidence": null,
        "sceneBoundaryStart": true,
        "sceneBoundaryEnd": false,
        "speechBoundaryStart": true,
        "speechBoundaryEnd": true,
        "needsReview": true,
        "warnings": ["Scene boundary is approximate."]
      }
    }
  ]
}
```

## Pipeline Stages

### 1. Input normalization

Create a job folder:

```text
work/<job-id>/
  input/
  extracted/
  stages/
  clips/
  covers/
  subtitles/
  manifest.json
  report.json
```

Store:

- Original file name.
- File hash.
- User metadata.
- Runtime options.

Why this matters:

- AI agents can inspect stage artifacts.
- Failed jobs can resume.
- Bugs can be reproduced without rerunning every heavy stage.

### 2. Media probe

Use FFmpeg/ffprobe to collect:

- Duration.
- Stream list.
- Audio stream language if present.
- Subtitle stream list.
- Frame rate.
- Resolution.
- Keyframe data if needed.

Output:

```text
stages/01-probe.json
```

### 3. Subtitle acquisition

Priority order:

1. External subtitle supplied by user.
2. Embedded subtitle stream.
3. Hard subtitle OCR.
4. ASR.

Important rule:

Do not merge low-confidence OCR with good ASR blindly. Treat each source as a candidate transcript with confidence and provenance.

Output:

```text
stages/02-subtitle-candidates.json
```

### 4. Subtitle alignment

If subtitles came from external or embedded files, run ffsubsync against the audio track.

If subtitles came from ASR, use WhisperX alignment.

Output:

```text
stages/03-aligned-cues.json
```

Each cue should include:

- `startMs`
- `endMs`
- `jaText`
- `zhText`
- `source`
- `confidence`

### 5. Boundary detection

Run:

- PySceneDetect for scene boundaries.
- VAD for speech regions and silence gaps.
- Sentence grouping from subtitle punctuation and cue timing.

Output:

```text
stages/04-boundaries.json
```

### 6. Japanese learning enrichment

For each Japanese segment:

- Tokenize with Sudachi.
- Resolve readings and normalized forms.
- Match grammar patterns.
- Resolve meanings from dictionary data.
- Pick focus terms only when meaning and example are reliable.

Output:

```text
stages/05-learning-data.json
```

The app should never have to guess whether a word is useful. The slicer should mark why a point was selected.

### 7. Candidate generation and scoring

Generate candidate windows from complete sentence groups. Then expand or contract boundaries to nearest good cut point.

Hard constraints:

- Default min duration: 8 seconds.
- Default target duration: 18-25 seconds.
- Default max duration: 45 seconds.
- No mid-sentence cuts unless the sentence is very long.
- Avoid cuts within 500 ms of active speech.
- Prefer scene boundaries within 1.5 seconds of subtitle boundaries.

Score dimensions:

- Speech completeness.
- Scene boundary quality.
- Subtitle timing confidence.
- Learning density.
- Context completeness.
- Duration fit.
- Audio/visual quality warnings.

Output:

```text
stages/06-candidates.json
```

### 8. Physical clipping

Use FFmpeg to create real clips.

Default:

- Re-encode to browser-friendly H.264/AAC MP4 for reliable playback.
- Generate `.vtt` subtitles per clip.
- Generate cover image near first strong sentence or visual midpoint.

Output:

```text
clips/<clip-id>.mp4
covers/<clip-id>.jpg
subtitles/<clip-id>.vtt
```

### 9. QA and report

Generate a machine-readable report:

```text
report.json
```

Include:

- Stage durations.
- Number of cues.
- Number of candidates.
- Number of accepted clips.
- Rejected candidate reasons.
- Low-confidence clips.
- Missing translations.
- Playback validation results.

This report is what future AI agents should read first when debugging poor slice quality.

## Extensibility Rules

Use adapters, not scattered conditionals.

Suggested interfaces:

```ts
interface TranscriptProvider {
  name: string
  transcribe(input: MediaInput, options: TranscriptOptions): Promise<TranscriptCandidate>
}

interface AlignmentProvider {
  name: string
  align(input: AlignmentInput): Promise<AlignedCue[]>
}

interface BoundaryProvider {
  name: string
  detect(input: BoundaryInput): Promise<BoundarySet>
}

interface LearningAnalyzer {
  name: string
  analyze(cues: AlignedCue[]): Promise<LearningData>
}

interface ClipScorer {
  name: string
  score(input: ClipCandidateInput): Promise<ScoredClipCandidate[]>
}
```

Rules:

- Every adapter must write its raw output under `stages/`.
- Every adapter must return confidence/provenance fields.
- Adding a new ASR/OCR/NLP backend should not require changing the app import model.
- The manifest is the boundary between slicer and app.

## AI-Friendly Requirements

To keep the system easy for future AI agents to modify:

- Keep every stage output as JSON or VTT/SRT files.
- Use deterministic file names and stable clip ids.
- Store raw and normalized outputs separately.
- Keep a small fixture video and expected manifest for regression tests.
- Document every scoring weight in one config file.
- Avoid hidden global state in the slicer engine.
- Prefer pure functions for candidate scoring and manifest conversion.
- Include `report.json` with rejected candidate reasons.
- Keep generated assets out of source control unless they are fixtures.

## Phased Implementation Plan

### Phase 0: Contract hardening

Scope:

- Add manifest v2 TypeScript types.
- Add manifest validation with actionable errors.
- Keep current manifest v1 import working.
- Add a small fixture manifest test.

Acceptance:

- The app imports v1 and v2 manifests.
- Invalid manifests produce clear UI errors.
- No changes to current browser preview behavior.

### Phase 1: Slicer CLI baseline

Scope:

- Implement or update `anime-learning-slicer` to write the job folder structure.
- Use FFmpeg to probe, extract audio, cut clips, and create covers.
- Use existing external subtitles first.
- Use current app manifest import path.

Acceptance:

- Given a video and `.srt/.ass`, the CLI produces real clips and manifest v2.
- The app imports those clips through advanced import.
- Generated clips play without source-video seeking.

### Phase 2: Production subtitle pipeline

Scope:

- Add faster-whisper or WhisperX.
- Add ffsubsync for external subtitles.
- Store aligned cues and confidence.
- Keep browser ASR only as fallback preview.

Acceptance:

- A no-subtitle video can produce Japanese timed subtitles.
- External subtitle timing drift is corrected.
- Low-confidence transcript jobs are marked `needsReview`.

### Phase 3: Better boundaries

Scope:

- Add PySceneDetect.
- Add Silero VAD or pyannote speech regions.
- Replace pure knowledge-density slicing with boundary-aware candidate scoring.

Acceptance:

- Clips do not start or end mid-sentence unless unavoidable.
- Clips prefer natural pauses and nearby scene boundaries.
- `report.json` explains why each accepted clip won.

### Phase 4: Japanese learning quality

Scope:

- Add Sudachi-based NLP.
- Add dictionary-backed meanings and readings.
- Move grammar matching data into a versioned resource file.
- Keep `segments.focusTermIds` compatible with the current player.

Acceptance:

- Knowledge points have reliable readings, base forms, examples, and source reasons.
- Low-quality unknown meanings are not promoted as focus terms.
- Current player displays imported learning data without special cases.

### Phase 5: Optional hard subtitle OCR

Scope:

- Add VideOCR/RapidVideOCR/EasyOCR as optional providers.
- Compare OCR subtitles against ASR/subtitle candidates.
- Do not overwrite stronger sources with weak OCR.

Acceptance:

- Hardsub-only videos can produce usable Chinese/Japanese subtitle candidates when OCR confidence is high.
- OCR failures remain review warnings, not fatal errors when ASR is usable.

### Phase 6: Service mode

Scope:

- Wrap the slicer CLI in a local or hosted worker API.
- Add job status polling to the app.
- Persist artifacts to configured storage.

Acceptance:

- The app can submit a job and import results without manually selecting manifest + clips.
- Long-running work does not run inside Vercel serverless functions.

## Feasibility Notes

- This is feasible as a CLI-first pipeline because the repository already has `ingest:video` and `watch:video-inbox` wrappers for a sibling slicer.
- Heavy work should not run in `api/*.mjs` Vercel functions because ASR/OCR/FFmpeg jobs are long-running and resource-heavy.
- GPU is optional but recommended. CPU mode can work for short videos and development fixtures.
- Browser processing remains useful for quick feedback, but it should not be the quality bar.

## Validation Strategy

Add tests at three levels:

1. Schema tests: manifest v1/v2 validation and import mapping.
2. Fixture tests: one short video with external subtitles, expected 2-3 clips, and stable manifest fields.
3. Golden report tests: candidate scoring produces understandable rejection reasons.

Manual QA checklist:

- Clip starts at a natural sentence boundary.
- Clip ends after a sentence completes.
- Japanese subtitle timing matches speech.
- Chinese subtitle is useful and not OCR noise.
- Knowledge points are present but not spammy.
- Clip plays directly from its own file.
- Import does not duplicate existing slices.

## Migration Plan

Short term:

- Keep current page preview.
- Keep current advanced manifest import.
- Add v2 manifest support.
- Make `anime-learning-slicer` the recommended path for serious slicing.

Medium term:

- Replace page auto-slicing copy with "quick preview" wording.
- Surface slicer reports in the app after import.
- Add import warnings for low-confidence clips.

Long term:

- Add service mode and job queue.
- Make slicing backend selectable by config.
- Keep app import model stable even if ASR/OCR/NLP providers change.

## Open Questions

- Should the production slicer live permanently in the sibling `anime-learning-slicer` repo or move into this repo under `server/slicer`?
- Should generated clips be stored in `public/generated-slices`, Vercel Blob, or another object store?
- Do we want fully local processing as the primary product behavior, or is a hosted worker acceptable?
- Which subtitle source should win when ASR and OCR disagree but both have medium confidence?

## First Implementation Ticket

Implement manifest v2 support in this app.

Deliverables:

- `SlicerManifestDataV2` and `SlicerManifestClipV2` types.
- Version-aware parser in `src/lib/slicerManifest.ts`.
- Quality warnings preserved in imported tags or metadata.
- Fixture manifest under `tests/fixtures`.
- Unit tests for v1 backward compatibility and v2 validation.

This keeps the first change small, improves the contract immediately, and prepares the app for a stronger slicer without destabilizing playback.

### Implementation Checklist

1. Add manifest v2 types without changing existing `ImportedClip` or `VideoLesson` contracts.
2. Split parsing into two layers: raw JSON validation and app-facing normalization.
3. Treat missing `version` as v1, and treat `version: 2` as the stricter contract.
4. Keep v1's current permissive behavior where possible, but make v2 validation field-specific.
5. Map v2 `quality.needsReview` and `quality.warnings` into import tags or preserved metadata.
6. Add fixture files:
   - `tests/fixtures/slicer-manifest-v1.json`
   - `tests/fixtures/slicer-manifest-v2.json`
   - `tests/fixtures/slicer-manifest-invalid-v2.json`
7. Add tests that prove:
   - v1 imports without a `version` field.
   - v2 imports with required pipeline and quality fields.
   - invalid v2 errors include the failing field path.
   - warning text survives normalization.

### Definition Of Done

- `npm run build` passes.
- The advanced import UI still accepts current v1 manifests.
- A v2 fixture with physical clip paths imports into the same short-video feed behavior.
- Invalid v2 manifests fail before uploading videos.
- The docs and fixture names make the next slicer-side implementation obvious.
