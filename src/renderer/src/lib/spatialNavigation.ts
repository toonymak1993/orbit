export type NavDirection = 'up' | 'down' | 'left' | 'right'
export const HOME_SHOW_BANNERS_EVENT = 'orbit:home-show-banners'

export function getFocusableElements(): HTMLElement[] {
  const activeScope = document.querySelector<HTMLElement>('[data-focus-scope="active"]')
  const root: ParentNode = activeScope ?? document
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-focusable]:not([data-disabled="true"])')
  ).filter((el) => el.offsetParent !== null && !el.closest('[inert]'))
}

/**
 * Nearest-neighbour spatial navigation: scores every other focusable element by
 * distance along the pressed axis, penalizing perpendicular offset so navigation
 * feels like moving through a grid rather than jumping to the literal closest point.
 */
export function findNextFocus(
  current: HTMLElement,
  direction: NavDirection
): HTMLElement | null {
  const shelfRow = Number(current.dataset.storeShelfRow)
  const shelfColumn = Number(current.dataset.storeShelfColumn)
  if (
    Number.isInteger(shelfRow) &&
    Number.isInteger(shelfColumn) &&
    (direction === 'up' || direction === 'down')
  ) {
    const targetRow = shelfRow + (direction === 'down' ? 1 : -1)
    const rowCandidates = getFocusableElements()
      .filter((candidate) => Number(candidate.dataset.storeShelfRow) === targetRow)
      .sort(
        (left, right) =>
          Number(left.dataset.storeShelfColumn) - Number(right.dataset.storeShelfColumn)
      )
    if (rowCandidates.length > 0) {
      return rowCandidates[Math.min(shelfColumn, rowCandidates.length - 1)]
    }
  }

  const grid = current.closest<HTMLElement>('[data-navigation-grid]')
  if (grid && current.hasAttribute('data-grid-index')) {
    const gridResult = findGridNeighbour(current, grid, direction)
    if (gridResult !== undefined) return gridResult
  }

  const currentRect = current.getBoundingClientRect()
  const candidates = getFocusableElements().filter(
    (el) =>
      el !== current &&
      (!el.hasAttribute('data-navigation-horizontal-only') ||
        direction === 'left' ||
        direction === 'right')
  )

  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const el of candidates) {
    if (
      el.hasAttribute('data-navigation-horizontal-only') &&
      direction !== 'left' &&
      direction !== 'right'
    ) continue
    const rect = el.getBoundingClientRect()
    let primary: number
    let secondary: number

    if (direction === 'right') {
      if (rect.left < currentRect.right - 1) continue
      primary = rect.left - currentRect.right
      secondary = Math.abs(centerY(rect) - centerY(currentRect))
    } else if (direction === 'left') {
      if (rect.right > currentRect.left + 1) continue
      primary = currentRect.left - rect.right
      secondary = Math.abs(centerY(rect) - centerY(currentRect))
    } else if (direction === 'down') {
      if (rect.top < currentRect.bottom - 1) continue
      primary = rect.top - currentRect.bottom
      secondary = Math.abs(centerX(rect) - centerX(currentRect))
    } else {
      if (rect.bottom > currentRect.top + 1) continue
      primary = currentRect.top - rect.bottom
      secondary = Math.abs(centerX(rect) - centerX(currentRect))
    }

    const score = primary * 2 + secondary
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }

  return best
}

/**
 * Large libraries must not run nearest-neighbour geometry against hundreds of
 * cards for every D-pad repeat. Grid position is deterministic, so moving in a
 * library grid is an O(1) DOM lookup. Returning `undefined` hands navigation
 * back to the generic geometry path; `null` means the grid edge was reached.
 */
function findGridNeighbour(
  current: HTMLElement,
  grid: HTMLElement,
  direction: NavDirection
): HTMLElement | null | undefined {
  const index = Number(current.dataset.gridIndex)
  const columns = Number(grid.dataset.gridColumns)
  if (!Number.isInteger(index) || !Number.isInteger(columns) || columns < 1) return undefined

  let targetIndex: number | null = null
  if (direction === 'left' && index % columns !== 0) targetIndex = index - 1
  if (direction === 'right' && index % columns !== columns - 1) targetIndex = index + 1
  if (direction === 'up' && index >= columns) targetIndex = index - columns
  if (direction === 'down') targetIndex = index + columns

  if (targetIndex !== null) {
    return grid.querySelector<HTMLElement>(`[data-grid-index="${targetIndex}"]`)
  }

  // From the first row, Up should still be able to reach filters/top navigation.
  // Exclude the grid itself so this rare edge lookup remains small and stable.
  if (direction === 'up') {
    return findNearestCandidate(
      current,
      direction,
      getFocusableElements().filter((candidate) => !grid.contains(candidate))
    )
  }

  return null
}

function findNearestCandidate(
  current: HTMLElement,
  direction: NavDirection,
  candidates: HTMLElement[]
): HTMLElement | null {
  const currentRect = current.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const el of candidates) {
    if (
      el.hasAttribute('data-navigation-horizontal-only') &&
      direction !== 'left' &&
      direction !== 'right'
    ) continue
    const rect = el.getBoundingClientRect()
    let primary: number
    let secondary: number

    if (direction === 'right') {
      if (rect.left < currentRect.right - 1) continue
      primary = rect.left - currentRect.right
      secondary = Math.abs(centerY(rect) - centerY(currentRect))
    } else if (direction === 'left') {
      if (rect.right > currentRect.left + 1) continue
      primary = currentRect.left - rect.right
      secondary = Math.abs(centerY(rect) - centerY(currentRect))
    } else if (direction === 'down') {
      if (rect.top < currentRect.bottom - 1) continue
      primary = rect.top - currentRect.bottom
      secondary = Math.abs(centerX(rect) - centerX(currentRect))
    } else {
      if (rect.bottom > currentRect.top + 1) continue
      primary = currentRect.top - rect.bottom
      secondary = Math.abs(centerX(rect) - centerX(currentRect))
    }

    const score = primary * 2 + secondary
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }

  return best
}

function centerX(rect: DOMRect): number {
  return (rect.left + rect.right) / 2
}
function centerY(rect: DOMRect): number {
  return (rect.top + rect.bottom) / 2
}

export function focusElement(el: HTMLElement | null): void {
  if (!el) return
  document
    .querySelectorAll('[data-focused="true"]')
    .forEach((n) => n.removeAttribute('data-focused'))
  el.setAttribute('data-focused', 'true')
  el.focus({ preventScroll: true })
  ensureFocusedElementVisible(el)
}

interface ScrollAnimation {
  frame: number
}

const activeScrollAnimations = new WeakMap<HTMLElement, ScrollAnimation>()
const scrollParentCache = new WeakMap<HTMLElement, HTMLElement[]>()

function ensureFocusedElementVisible(el: HTMLElement): void {
  const scrollParents = findScrollParents(el)
  if (scrollParents.length === 0) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return
  }

  for (const scrollParent of scrollParents) {
    const parentRect = scrollParent.getBoundingClientRect()
    const elementRect = el.getBoundingClientRect()
    const margin = Math.min(32, Math.max(12, scrollParent.clientHeight * 0.035))
    const canScrollY = scrollParent.scrollHeight > scrollParent.clientHeight + 1
    const canScrollX = scrollParent.scrollWidth > scrollParent.clientWidth + 1
    let deltaTop = 0
    let deltaLeft = 0
    let targetTop: number | undefined

    if (canScrollY && elementRect.top < parentRect.top + margin) {
      deltaTop = elementRect.top - parentRect.top - margin
    } else if (canScrollY && elementRect.bottom > parentRect.bottom - margin) {
      deltaTop = elementRect.bottom - parentRect.bottom + margin
    }

    if (canScrollY) {
      const verticalPeers = getFocusableElements().filter(
        (candidate) => candidate !== el && scrollParent.contains(candidate)
      )
      const elementCenter = centerY(elementRect)
      const hasFocusableAbove = verticalPeers.some(
        (candidate) => centerY(candidate.getBoundingClientRect()) < elementCenter - 8
      )
      const hasFocusableBelow = verticalPeers.some(
        (candidate) => centerY(candidate.getBoundingClientRect()) > elementCenter + 8
      )
      if (!hasFocusableAbove) targetTop = 0
      else if (!hasFocusableBelow) {
        targetTop = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
      }
    }

    if (canScrollX && elementRect.left < parentRect.left + margin) {
      deltaLeft = elementRect.left - parentRect.left - margin
    } else if (canScrollX && elementRect.right > parentRect.right - margin) {
      deltaLeft = elementRect.right - parentRect.right + margin
    }

    if (targetTop === undefined && Math.abs(deltaTop) < 1 && Math.abs(deltaLeft) < 1) continue
    animateScrollTo(
      scrollParent,
      targetTop ?? Math.max(0, scrollParent.scrollTop + deltaTop),
      Math.max(0, scrollParent.scrollLeft + deltaLeft)
    )
  }
}

function findScrollParents(el: HTMLElement): HTMLElement[] {
  const cached = scrollParentCache.get(el)
  if (cached) return cached
  const parents: HTMLElement[] = []
  let parent = el.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    const canScrollY =
      /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1
    const canScrollX =
      /(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1
    if (canScrollY || canScrollX) {
      parents.push(parent)
    }
    parent = parent.parentElement
  }
  scrollParentCache.set(el, parents)
  return parents
}

function animateScrollTo(element: HTMLElement, targetTop: number, targetLeft: number): void {
  const previous = activeScrollAnimations.get(element)
  if (previous) cancelAnimationFrame(previous.frame)

  const startTop = element.scrollTop
  const startLeft = element.scrollLeft
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight)
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth)
  const finalTop = Math.min(targetTop, maxTop)
  const finalLeft = Math.min(targetLeft, maxLeft)
  const startedAt = performance.now()
  const duration = 105
  const animation: ScrollAnimation = { frame: 0 }

  const tick = (now: number): void => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    element.scrollTop = startTop + (finalTop - startTop) * eased
    element.scrollLeft = startLeft + (finalLeft - startLeft) * eased
    if (progress < 1) {
      animation.frame = requestAnimationFrame(tick)
    } else {
      activeScrollAnimations.delete(element)
    }
  }

  animation.frame = requestAnimationFrame(tick)
  activeScrollAnimations.set(element, animation)
}

export function focusFirstIn(container: ParentNode = document): void {
  const activeScope = document.querySelector<HTMLElement>('[data-focus-scope="active"]')
  const root = activeScope && container === document ? activeScope : container
  const el = root.querySelector<HTMLElement>('[data-focusable]:not([data-disabled="true"])')
  focusElement(el)
}

export function moveFocus(direction: NavDirection): boolean {
  const current = document.activeElement as HTMLElement | null
  if (!current || !current.hasAttribute('data-focusable')) {
    const previous = document.activeElement
    focusFirstIn()
    return document.activeElement !== previous
  }
  if (
    direction === 'up' &&
    current.matches('[data-home-game-card="true"]') &&
    document.querySelector('[data-home-jump-back="true"]')
  ) {
    window.dispatchEvent(new CustomEvent(HOME_SHOW_BANNERS_EVENT))
    return true
  }
  const next = findNextFocus(current, direction)
  if (!next) return false
  focusElement(next)
  return true
}
