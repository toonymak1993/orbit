type BackHandler = () => void

const stack: BackHandler[] = []

export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler)
  return () => {
    const idx = stack.lastIndexOf(handler)
    if (idx !== -1) stack.splice(idx, 1)
  }
}

export function triggerBack(): boolean {
  const handler = stack[stack.length - 1]
  if (!handler) return false
  handler()
  return true
}
