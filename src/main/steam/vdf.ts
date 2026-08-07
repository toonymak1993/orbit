export interface VdfObject {
  [key: string]: string | VdfObject
}

interface Token {
  type: 'string' | 'open' | 'close'
  value?: string
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0

  while (cursor < source.length) {
    const char = source[cursor]
    if (/\s/.test(char)) {
      cursor++
      continue
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor = source.indexOf('\n', cursor + 2)
      if (cursor === -1) break
      continue
    }
    if (char === '{' || char === '}') {
      tokens.push({ type: char === '{' ? 'open' : 'close' })
      cursor++
      continue
    }
    if (char !== '"') {
      cursor++
      continue
    }

    cursor++
    let value = ''
    while (cursor < source.length) {
      const current = source[cursor++]
      if (current === '"') break
      if (current === '\\' && cursor < source.length) {
        const escaped = source[cursor++]
        value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped
      } else {
        value += current
      }
    }
    tokens.push({ type: 'string', value })
  }

  return tokens
}

/** Minimal Valve KeyValues parser for Steam's local manifests/config files. */
export function parseVdf(source: string): VdfObject {
  const tokens = tokenize(source)
  let cursor = 0

  const readObject = (stopAtClose: boolean): VdfObject => {
    const output: VdfObject = {}
    while (cursor < tokens.length) {
      if (tokens[cursor].type === 'close') {
        cursor++
        if (stopAtClose) break
        continue
      }

      const keyToken = tokens[cursor++]
      if (keyToken.type !== 'string' || !keyToken.value) continue
      const valueToken = tokens[cursor++]
      if (!valueToken) break

      if (valueToken.type === 'open') {
        output[keyToken.value] = readObject(true)
      } else if (valueToken.type === 'string') {
        output[keyToken.value] = valueToken.value ?? ''
      }
    }
    return output
  }

  return readObject(false)
}

export function vdfObject(value: string | VdfObject | undefined): VdfObject | undefined {
  return value && typeof value === 'object' ? value : undefined
}

export function vdfString(value: string | VdfObject | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function getVdfValue(object: VdfObject | undefined, key: string): string | VdfObject | undefined {
  if (!object) return undefined
  const actualKey = Object.keys(object).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
  return actualKey ? object[actualKey] : undefined
}
