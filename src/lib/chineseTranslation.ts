const GENERIC_CHINESE_PATTERNS = [
  /^\u8bf7\u7ed3\u5408\u8bed\u5883/u,
  /^\u5148\u7ed3\u5408\u8bed\u5883/u,
  /^\u9700\u8981\u7ed3\u5408(?:\u4e0a\u4e0b\u6587|\u8bed\u5883)/u,
  /^\u8fd9\u53e5/u,
  /^\u8fd9\u6bb5/u,
  /^\u5927\u610f\u56f4\u7ed5/u,
  /^\u53e5\u91cc/u,
  /\u5148\u770b\u539f\u53e5/u,
  /\u6682\u672a\u6536\u5f55/u,
]

function countChineseCharacters(input: string) {
  return (input.match(/[\u4e00-\u9fff]/gu) || []).length
}

function countJapaneseCharacters(input: string) {
  return (
    input.match(
      /[\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u30ff\u3400-\u9fff]/gu,
    ) || []
  ).length
}

export function isUsableChineseSubtitle(japaneseText: string, chineseText?: string) {
  const normalized = chineseText?.trim() ?? ''
  if (!normalized) {
    return false
  }

  if (GENERIC_CHINESE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false
  }

  if (/[\\/]/u.test(normalized)) {
    return false
  }

  const chineseCount = countChineseCharacters(normalized)
  if (chineseCount === 0) {
    return false
  }

  const japaneseCount = Math.max(1, countJapaneseCharacters(japaneseText))
  const hasSentencePunctuation = /[。！？!?…]$/u.test(normalized)

  if (chineseCount >= 5) {
    return true
  }

  if (chineseCount >= 4 && hasSentencePunctuation) {
    return true
  }

  if (chineseCount >= 3 && japaneseCount <= 4) {
    return true
  }

  return false
}
