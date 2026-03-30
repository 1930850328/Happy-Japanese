let cachedVoice: SpeechSynthesisVoice | null = null
let voiceLoadPromise: Promise<SpeechSynthesisVoice | null> | null = null

function canUseSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function findJapaneseVoiceFromList(voices: SpeechSynthesisVoice[]) {
  return voices.find((voice) => voice.lang.toLowerCase().startsWith('ja')) ?? null
}

function readImmediateVoice() {
  if (!canUseSpeechSynthesis()) {
    return null
  }

  if (cachedVoice) {
    return cachedVoice
  }

  cachedVoice = findJapaneseVoiceFromList(window.speechSynthesis.getVoices())
  return cachedVoice
}

function waitForJapaneseVoice(timeoutMs = 1600) {
  if (!canUseSpeechSynthesis()) {
    return Promise.resolve<SpeechSynthesisVoice | null>(null)
  }

  const voice = readImmediateVoice()
  if (voice || window.speechSynthesis.getVoices().length > 0) {
    return Promise.resolve(voice)
  }

  if (voiceLoadPromise) {
    return voiceLoadPromise
  }

  voiceLoadPromise = new Promise<SpeechSynthesisVoice | null>((resolve) => {
    const synth = window.speechSynthesis

    const finish = () => {
      synth.removeEventListener('voiceschanged', handleVoicesChanged)
      window.clearTimeout(timeoutId)
      cachedVoice = findJapaneseVoiceFromList(synth.getVoices())
      voiceLoadPromise = null
      resolve(cachedVoice)
    }

    const handleVoicesChanged = () => {
      finish()
    }

    const timeoutId = window.setTimeout(finish, timeoutMs)
    synth.addEventListener('voiceschanged', handleVoicesChanged)
  })

  return voiceLoadPromise
}

function createUtterance(text: string, voice: SpeechSynthesisVoice | null) {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  utterance.rate = 0.92
  utterance.pitch = 1.02
  if (voice) {
    utterance.voice = voice
  }
  return utterance
}

function performSpeak(text: string, voice: SpeechSynthesisVoice | null) {
  if (!canUseSpeechSynthesis() || !text.trim()) {
    return false
  }

  const utterance = createUtterance(text, voice)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}

export function primeSpeechVoices() {
  if (!canUseSpeechSynthesis()) {
    return
  }

  void waitForJapaneseVoice()
}

export function hasJapaneseSpeechSupport() {
  return canUseSpeechSynthesis()
}

export function speakJapanese(text: string) {
  if (!canUseSpeechSynthesis() || !text.trim()) {
    return false
  }

  const immediateVoice = readImmediateVoice()
  if (immediateVoice || window.speechSynthesis.getVoices().length > 0) {
    return performSpeak(text, immediateVoice)
  }

  void waitForJapaneseVoice().then((voice) => {
    performSpeak(text, voice)
  })

  return true
}
