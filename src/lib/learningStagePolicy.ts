import type { SongStudyIndex, SongStudyOccurrence, StudyStage } from '../types'

export interface StudyStageOption {
  id: StudyStage
  label: string
  shortLabel: string
}

export const studyStageOptions: StudyStageOption[] = [
  { id: 'beginner', label: '初级', shortLabel: '初' },
  { id: 'intermediate', label: '中级', shortLabel: '中' },
  { id: 'advanced', label: '高级', shortLabel: '高' },
]

export function getStudyStageLabel(stage: StudyStage) {
  return studyStageOptions.find((option) => option.id === stage)?.label ?? '初级'
}

export function getNextStudyStage(stage: StudyStage) {
  const index = studyStageOptions.findIndex((option) => option.id === stage)
  return studyStageOptions[(index + 1) % studyStageOptions.length]?.id ?? 'beginner'
}

export function isOccurrenceFocusedForStage(
  occurrence: SongStudyOccurrence,
  index: SongStudyIndex | null | undefined,
  stage: StudyStage,
) {
  const focusIds = index?.stagePlans[stage]?.focusOccurrenceIds
  return focusIds ? focusIds.includes(occurrence.id) : occurrence.stage === stage
}
