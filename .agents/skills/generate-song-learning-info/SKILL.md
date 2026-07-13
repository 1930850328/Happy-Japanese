---
name: generate-song-learning-info
description: Generate structured Japanese song learning information from saved song metadata and lyric lines. Use when a Worker asks Codex to translate lyrics for Chinese learners and extract contextual vocabulary or grammar into the song learning JSON schema.
---

# Generate Song Learning Information

Treat this skill as the sole source of learning-content strategy. The runtime wrapper only supplies the input JSON and output schema.

## Workflow

1. Read the complete song input before processing individual lines. Use the title, artist, neighboring lines, and repeated expressions only as context supported by the input.
2. Preserve every `lineId` exactly once and keep the original line order.
3. Write a natural, accurate Simplified Chinese（简体中文）translation for every line. Avoid literal translation when it harms meaning, but do not invent plot or intent absent from the lyrics.
4. Select only one to four genuinely useful expressions per line. Prefer contextual words, fixed expressions, and explicit grammar patterns; do not select isolated particles unless they form a real grammar pattern.
5. Copy each `expression` as a continuous substring of that line's Japanese text. Never rewrite or normalize it.
6. Write `reading` in hiragana. Make `meaningZh` a concrete contextual Chinese meaning and make `explanationZh` explain the expression's usage or nuance in that line.
7. Classify each item as `word` or `grammar`, choose the learner stage from the output schema, and omit any item whose contextual confidence is below `0.8`.
8. Return only JSON conforming to the supplied output schema. Do not add Markdown or commentary.

## Quality Gate

Before returning, verify that:

- all learner-facing translations, meanings, and explanations are Simplified Chinese;
- no meaning contains placeholders such as “待补充”, “待确认”, “未知”, or “不明”;
- no Chinese meaning merely repeats the Japanese expression;
- every selected expression exists in its source line;
- uncertain interpretations are omitted instead of guessed;
- no external files, network sources, or unrelated tools were used as evidence.
