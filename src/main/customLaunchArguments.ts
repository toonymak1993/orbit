const MAX_COMMAND_LINE_LENGTH = 4_096
const MAX_ARGUMENT_COUNT = 128
const MAX_ARGUMENT_LENGTH = 2_048

/**
 * Normalizes the user-facing launch-options field without ever turning it into
 * a shell command. The parsed argv is passed directly to child_process.spawn.
 */
export function normalizeCustomLaunchArguments(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Invalid custom game launch arguments')

  const normalized = value.trim()
  if (!normalized) return undefined
  if (
    normalized.length > MAX_COMMAND_LINE_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(normalized)
  ) {
    throw new Error('Invalid custom game launch arguments')
  }

  // Parse once at the trust boundary so malformed quoting is rejected when the
  // user saves it, rather than only when a game is launched later.
  parseCustomLaunchArguments(normalized)
  return normalized
}

/**
 * Splits a Windows-style argument string into argv using the backslash/quote
 * rules used by CommandLineToArgvW. No shell expansion, environment expansion,
 * globbing or command substitution is performed.
 */
export function parseCustomLaunchArguments(commandLine?: string): string[] {
  if (!commandLine?.trim()) return []

  const input = commandLine.trim()
  const args: string[] = []
  let cursor = 0

  while (cursor < input.length) {
    while (cursor < input.length && /\s/.test(input[cursor])) cursor++
    if (cursor >= input.length) break

    let argument = ''
    let inQuotes = false
    let started = false

    while (cursor < input.length) {
      const character = input[cursor]
      if (!inQuotes && /\s/.test(character)) break

      if (character === '\\') {
        const slashStart = cursor
        while (cursor < input.length && input[cursor] === '\\') cursor++
        const slashCount = cursor - slashStart

        if (input[cursor] === '"') {
          argument += '\\'.repeat(Math.floor(slashCount / 2))
          started = true
          if (slashCount % 2 === 1) {
            argument += '"'
            cursor++
          } else {
            inQuotes = !inQuotes
            cursor++
          }
        } else {
          argument += '\\'.repeat(slashCount)
          started = true
        }
        continue
      }

      if (character === '"') {
        started = true
        if (inQuotes && input[cursor + 1] === '"') {
          argument += '"'
          cursor += 2
        } else {
          inQuotes = !inQuotes
          cursor++
        }
        continue
      }

      argument += character
      started = true
      cursor++
    }

    if (inQuotes) throw new Error('Invalid custom game launch arguments')
    if (argument.length > MAX_ARGUMENT_LENGTH) {
      throw new Error('Invalid custom game launch arguments')
    }
    if (started) args.push(argument)
    if (args.length > MAX_ARGUMENT_COUNT) {
      throw new Error('Invalid custom game launch arguments')
    }

    while (cursor < input.length && /\s/.test(input[cursor])) cursor++
  }

  return args
}
