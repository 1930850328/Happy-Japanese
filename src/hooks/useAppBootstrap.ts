import { useEffect } from 'react'

import { primeSpeechVoices } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'

export function useAppBootstrap() {
  const initialize = useAppStore((state) => state.initialize)
  const refreshPublishedLessons = useAppStore((state) => state.refreshPublishedLessons)

  useEffect(() => {
    void initialize()
    primeSpeechVoices()
  }, [initialize])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshPublishedLessons()
      }
    }, 15000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshPublishedLessons])
}
