# anime-learning-slicer

Production slicer package for Happy-Japanese.

The package is intentionally kept inside this monorepo so the app, manifest contract, tests, and slicer engine evolve together. The user-facing product flow is still one action: provide a source video. Subtitles, generated clips, covers, metadata, and `manifest.json` are internal artifacts.

## Current Pipeline

1. Probe the source video with `ffprobe`.
2. Acquire timed Japanese cues from same-name subtitle assets, Japanese embedded subtitle tracks, or Transformers.js Whisper ASR.
3. If a Chinese embedded subtitle track exists, use it as translation timing without mistaking it for Japanese source text.
4. Enrich cues with Chinese translations, Kuromoji tokenization, Wanakana readings/romaji, and grammar pattern hits.
5. Detect speech pauses with FFmpeg `silencedetect`.
6. Score complete subtitle windows by learning value, duration fit, and nearby silence boundaries.
7. Cut real browser-playable MP4 clips with FFmpeg, then write covers, per-clip VTT subtitles, metadata, `manifest.json`, and `report.json`.
8. Update `public/generated-slices/index.json` only when the output is inside `public/generated-slices`.

## Commands

```bash
npm run ingest:video -- --input ./episode01.mp4 --anime "Bocchi the Rock!" --episode "EP01"
npm run watch:video-inbox
npm --workspace anime-learning-slicer run check
```

Useful options:

- `--publishedSlug <slug>` controls the output folder under `public/generated-slices`.
- `--asrModel <model>` overrides the default Transformers.js Whisper model. The default favors quality with `onnx-community/whisper-small_timestamped`; `onnx-community/whisper-base_timestamped` is the fallback.
- `--noAsr` makes missing subtitles fail fast instead of downloading/running ASR.
- `--minDurationSec`, `--targetDurationSec`, `--maxDurationSec`, and `--maxClips` tune candidate selection.

## Design Boundary

Keep heavyweight slicing out of the React runtime. Future providers such as WhisperX, faster-whisper, ffsubsync, PySceneDetect, Sudachi, and OCR should be added behind provider modules in this package without changing the app-facing manifest v2 contract.
