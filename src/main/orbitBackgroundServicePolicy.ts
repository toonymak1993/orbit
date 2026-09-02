import type { OrbitBackgroundServiceStatus } from '@shared/ipc'

export const BACKGROUND_AGENT_RESTART_BASE_MS = 1_500
export const BACKGROUND_AGENT_RESTART_MAX_MS = 60_000
export const BACKGROUND_AGENT_STABLE_MS = 30_000

export interface WindowsLoginLaunchItem {
  name: string
  path: string
  args: string[]
  enabled: boolean
  scope?: 'user' | 'machine'
}

export interface WindowsLoginItemSnapshot {
  openAtLogin: boolean
  executableWillLaunchAtLogin: boolean
  launchItems: WindowsLoginLaunchItem[]
}

export interface WindowsLoginItemExpectation {
  name: string
  path: string
  args: string[]
}

function normalizedWindowsArgument(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

function normalizedWindowsName(value: string): string {
  return value.trim().toLowerCase()
}

function loginArgumentsMatch(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (value, index) =>
        normalizedWindowsArgument(value) === normalizedWindowsArgument(expected[index])
    )
  )
}

function loginItemConfigurationMatches(
  item: WindowsLoginLaunchItem,
  expected: WindowsLoginItemExpectation
): boolean {
  return (
    normalizedWindowsArgument(item.path) === normalizedWindowsArgument(expected.path) &&
    loginArgumentsMatch(item.args, expected.args)
  )
}

export function classifyWindowsLoginItem(
  snapshot: WindowsLoginItemSnapshot,
  expected: WindowsLoginItemExpectation
): Pick<OrbitBackgroundServiceStatus, 'installation' | 'reason'> {
  const expectedName = normalizedWindowsName(expected.name)
  const namedItems = snapshot.launchItems.filter(
    (item) => normalizedWindowsName(item.name) === expectedName
  )
  const userItem = namedItems.find((item) => item.scope === 'user')
  const enabledMachineItems = namedItems.filter(
    (item) => item.scope === 'machine' && item.enabled
  )
  const matchingEnabledMachineItem = enabledMachineItems.find((item) =>
    loginItemConfigurationMatches(item, expected)
  )
  if (matchingEnabledMachineItem) {
    // An active matching HKLM item is authoritative even when Windows also
    // reports a disabled or stale per-user item.
    return { installation: 'installed', reason: 'machine-login-item' }
  }
  if (enabledMachineItems.length > 0) {
    // ORBIT cannot safely overwrite an administrator-managed machine entry by
    // adding a competing HKCU value. Surface the conflict without auto-repair.
    return { installation: 'repair-needed', reason: 'machine-configuration-mismatch' }
  }

  const namedItem = userItem ?? namedItems[0]
  if (namedItem) {
    if (!userItem && namedItem.scope === 'machine' && !namedItem.enabled) {
      return { installation: 'not-installed' }
    }
    if (!loginItemConfigurationMatches(namedItem, expected)) {
      return { installation: 'repair-needed', reason: 'configuration-mismatch' }
    }
    if (!namedItem.enabled || !snapshot.executableWillLaunchAtLogin) {
      return { installation: 'repair-needed', reason: 'login-item-disabled' }
    }
    return { installation: 'installed' }
  }

  if (snapshot.openAtLogin && snapshot.executableWillLaunchAtLogin) {
    return { installation: 'installed' }
  }
  if (snapshot.openAtLogin && !snapshot.executableWillLaunchAtLogin) {
    return { installation: 'repair-needed', reason: 'login-item-disabled' }
  }
  return { installation: 'not-installed' }
}

export function backgroundAgentRestartDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(0, Math.min(16, Math.trunc(attempt)))
  return Math.min(
    BACKGROUND_AGENT_RESTART_MAX_MS,
    BACKGROUND_AGENT_RESTART_BASE_MS * 2 ** normalizedAttempt
  )
}
