import { useEffect } from 'react'

import { primeSpeechVoices } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'

export function useAppBootstrap() {
  const initialize = useAppStore((state) => state.initialize)

  useEffect(() => {
    void initialize()
    primeSpeechVoices()
  }, [initialize])
}
