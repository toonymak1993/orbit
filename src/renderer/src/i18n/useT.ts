import { useCallback } from 'react'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { translate, type TranslationKey } from './translations'

export type TFunction = (key: TranslationKey, vars?: Record<string, string | number>) => string

export function useT(): TFunction {
  const language = usePreferencesStore((s) => s.language)
  return useCallback<TFunction>((key, vars) => translate(language, key, vars), [language])
}
