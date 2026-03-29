let cachedVoice: SpeechSynthesisVoice | null = null

export function hasJapaneseSpeechSupport() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false
  }

  return findJapaneseVoice() !== null
}

function findJapaneseVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null
  }

  if (cachedVoice) {
    return cachedVoice
  }

  const voices = window.speechSynthesis.getVoices()
  cachedVoice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith('ja')) ?? null
  return cachedVoice
}

export function speakJapanese(text: string) {
  if (!text.trim() || !hasJapaneseSpeechSupport()) {
    return false
  }

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  utterance.rate = 0.92
  utterance.pitch = 1.02
  const voice = findJapaneseVoice()
  if (voice) {
    utterance.voice = voice
  }

  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}
