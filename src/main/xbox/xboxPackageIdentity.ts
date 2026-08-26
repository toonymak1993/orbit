const PACKAGE_FAMILY_PATTERN = /^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/

/** Validates the path-free Package Family Name used to join Xbox events to library games. */
export function normalizeXboxPackageFamilyName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  return candidate.length > 0 && candidate.length <= 255 && PACKAGE_FAMILY_PATTERN.test(candidate)
    ? candidate
    : undefined
}
