import { settingsStore } from './settingsStore'

const dict = {
  en: {
    noActiveSession: 'No active Steam session',
    loginFailed: 'Steam login failed',
    librarySessionUnavailable:
      'Steam signed in, but the library session could not be verified. Please reconnect and try again.',
    libraryLoadFailed: 'Could not load your Steam library (status {status})',
    epicNoActiveSession: 'No active Epic Games session',
    epicLoginFailed: 'Epic Games login failed'
  },
  de: {
    noActiveSession: 'Keine aktive Steam-Session',
    loginFailed: 'Steam-Login fehlgeschlagen',
    librarySessionUnavailable:
      'Steam ist angemeldet, aber die Bibliotheks-Session konnte nicht bestätigt werden. Bitte verbinde Steam erneut.',
    libraryLoadFailed: 'Steam-Bibliothek konnte nicht geladen werden (Status {status})',
    epicNoActiveSession: 'Keine aktive Epic-Games-Session',
    epicLoginFailed: 'Epic-Games-Login fehlgeschlagen'
  }
} as const

type Key = keyof (typeof dict)['en']

export function t(key: Key, vars?: Record<string, string | number>): string {
  const language = settingsStore.get('language')
  let text: string = dict[language]?.[key] ?? dict.en[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}
