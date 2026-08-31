export type NavDirection = 'up' | 'down' | 'left' | 'right'
export const HOME_SHOW_BANNERS_EVENT = 'orbit:home-show-banners'

function getActiveFocusScope(): HTMLElement | null {
  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-focus-scope="active"]')
  )
  return (
    scopes
      .reverse()
      .find((scope) => scope.offsetParent !== null && !scope.closest('[inert]')) ?? null
  )
}

export function getFocusableElements(): HTMLElement[] {
  const activeScope = getActiveFocusScope()
  const root: ParentNode = activeScope ?? document
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-focusable]:not([data-disabled="true"])')
  ).filter((el) => el.offsetParent !== null && !el.closest('[inert]'))
}

/**
 * Nearest-neighbour spatial navigation. Direction is determined from element
 * centres so visually adjacent controls remain reachable when rounded cards,
 * focus transforms or responsive layouts make their rectangles overlap slightly.
 */
export function findNextFocus(
  current: HTMLElement,
  direction: NavDirection
): HTMLElement | null {
  const applicationTarget = findApplicationTarget(current, direction)
  if (applicationTarget !== undefined) return applicationTarget

  const coreSenseTarget = findCoreSenseTarget(current, direction)
  if (coreSenseTarget) return coreSenseTarget

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

  return findNearestCandidate(current, direction, getFocusableElements())
}

interface ApplicationNavigationItem {
  element: HTMLElement
  rect: DOMRect
  centerX: number
  centerY: number
}

interface ApplicationNavigationRow {
  centerY: number
  items: ApplicationNavigationItem[]
}

/**
 * Applications is a vertically scrolling console shelf. Its cards form a
 * deliberate matrix, so navigation must not leak into the floating top bar or
 * skip an incomplete row just because another card is closer geometrically.
 */
function findApplicationTarget(
  current: HTMLElement,
  direction: NavDirection
): HTMLElement | null | undefined {
  const pane = document.querySelector<HTMLElement>('[data-view-pane="applications"]:not([inert])')
  if (!pane || pane.getAttribute('aria-hidden') === 'true') return undefined

  const items = getFocusableElements()
    .filter(
      (candidate) =>
        pane.contains(candidate) && candidate.hasAttribute('data-application-nav-item')
    )
    .map((element): ApplicationNavigationItem => {
      const rect = element.getBoundingClientRect()
      return {
        element,
        rect,
        centerX: centerX(rect),
        centerY: centerY(rect)
      }
    })

  if (direction === 'down' && current.closest('[data-top-nav]')) {
    return (
      items.find((item) => item.element.dataset.applicationLastFocus === 'true')?.element ??
      items.find((item) => item.element.dataset.viewEntry === 'true')?.element ??
      items[0]?.element ??
      null
    )
  }
  if (!current.hasAttribute('data-application-nav-item')) return undefined

  const rows = applicationNavigationRows(items)
  const rowIndex = rows.findIndex((row) => row.items.some((item) => item.element === current))
  if (rowIndex < 0) return null
  const row = rows[rowIndex]
  const itemIndex = row.items.findIndex((item) => item.element === current)
  if (itemIndex < 0) return null

  if (direction === 'left' || direction === 'right') {
    return row.items[itemIndex + (direction === 'right' ? 1 : -1)]?.element ?? null
  }

  const targetRow = rows[rowIndex + (direction === 'down' ? 1 : -1)]
  if (!targetRow) return null
  const currentX = row.items[itemIndex].centerX
  return [...targetRow.items].sort(
    (left, right) =>
      Math.abs(left.centerX - currentX) - Math.abs(right.centerX - currentX) ||
      left.centerX - right.centerX
  )[0]?.element ?? null
}

function applicationNavigationRows(
  items: ApplicationNavigationItem[]
): ApplicationNavigationRow[] {
  const rows: ApplicationNavigationRow[] = []
  const sortedItems = [...items].sort(
    (left, right) => left.centerY - right.centerY || left.centerX - right.centerX
  )
  for (const item of sortedItems) {
    const row = rows.at(-1)
    const tolerance = Math.max(10, item.rect.height * 0.32)
    if (!row || Math.abs(row.centerY - item.centerY) > tolerance) {
      rows.push({ centerY: item.centerY, items: [item] })
      continue
    }
    row.items.push(item)
    row.centerY = row.items.reduce((sum, candidate) => sum + candidate.centerY, 0) / row.items.length
  }
  for (const row of rows) row.items.sort((left, right) => left.centerX - right.centerX)
  return rows
}

/**
 * CoreSense has three intentionally separated vertical layers. Their large,
 * asymmetric rectangles make a purely geometric jump ambiguous on some
 * aspect ratios, so the D-pad contract is explicit while horizontal movement
 * inside both grids continues to use the shared O(1) grid path.
 */
function findCoreSenseTarget(
  current: HTMLElement,
  direction: NavDirection
): HTMLElement | null {
  const coreSenseHome = document.querySelector('[data-home-layout="coresense"]')
  if (coreSenseHome && direction === 'down' && current.closest('[data-top-nav]')) {
    return (
      document.querySelector<HTMLElement>('[data-coresense-launcher][data-active="true"]') ??
      document.querySelector<HTMLElement>('[data-coresense-launcher]')
    )
  }

  if (direction === 'up' && current.matches('[data-coresense-launcher]')) {
    return getPreferredTopNavEntry()
  }

  if (direction === 'down' && current.matches('[data-coresense-launcher]')) {
    return document.querySelector<HTMLElement>('[data-coresense-primary="true"]')
  }

  if (current.matches('[data-coresense-primary="true"]')) {
    if (direction === 'down') {
      return document.querySelector<HTMLElement>('[data-coresense-recommendation]')
    }
    if (direction === 'up') {
      return (
        document.querySelector<HTMLElement>('[data-coresense-launcher][data-active="true"]') ??
        document.querySelector<HTMLElement>('[data-coresense-launcher]')
      )
    }
  }

  if (direction === 'up' && current.matches('[data-coresense-recommendation]')) {
    return document.querySelector<HTMLElement>('[data-coresense-primary="true"]')
  }

  return null
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
    const target = grid.querySelector<HTMLElement>(`[data-grid-index="${targetIndex}"]`)
    if (
      !target &&
      grid.dataset.gridExitY === 'true' &&
      (direction === 'up' || direction === 'down')
    ) {
      return undefined
    }
    return target
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
    if (el === current) continue
    const score = scoreDirectionalCandidate(currentRect, el.getBoundingClientRect(), direction)
    if (score === null) continue
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }

  if (direction === 'up' && best?.closest('[data-top-nav]') && !current.closest('[data-top-nav]')) {
    return getPreferredTopNavEntry() ?? best
  }

  return best
}

/**
 * Entering the top navigation should feel deterministic instead of depending on
 * card geometry. Restore the last item used there; before the first visit, the
 * active view is the most useful anchor, with Home as the stable fallback.
 */
function getPreferredTopNavEntry(): HTMLElement | null {
  const topNav = document.querySelector<HTMLElement>('[data-top-nav]')
  if (!topNav || topNav.closest('[inert]')) return null

  return (
    topNav.querySelector<HTMLElement>(
      '[data-top-nav-last-focus="true"][data-focusable]:not([data-disabled="true"])'
    ) ??
    topNav.querySelector<HTMLElement>('[aria-current="page"][data-focusable]') ??
    topNav.querySelector<HTMLElement>('[data-main-view="home"][data-focusable]') ??
    topNav.querySelector<HTMLElement>('[data-focusable]:not([data-disabled="true"])')
  )
}

interface NavigationRect {
  top: number
  right: number
  bottom: number
  left: number
}

const DIRECTION_EPSILON = 1
const OFF_AXIS_ENTRY_PENALTY = 160

/**
 * Scores a candidate in the requested half-plane. The edge gap makes the next
 * nearby control win, while the larger perpendicular-gap penalty keeps movement
 * in a visible row or column whenever possible. Returning null rejects elements
 * whose centre is not actually in the requested direction.
 */
export function scoreDirectionalCandidate(
  current: NavigationRect,
  candidate: NavigationRect,
  direction: NavDirection
): number | null {
  const horizontal = direction === 'left' || direction === 'right'
  const forward = direction === 'right' || direction === 'down'
  const currentPrimaryCenter = horizontal ? centerX(current) : centerY(current)
  const candidatePrimaryCenter = horizontal ? centerX(candidate) : centerY(candidate)
  const primaryCenterDistance = forward
    ? candidatePrimaryCenter - currentPrimaryCenter
    : currentPrimaryCenter - candidatePrimaryCenter

  if (primaryCenterDistance <= DIRECTION_EPSILON) return null

  const primaryGap = Math.max(
    0,
    direction === 'right'
      ? candidate.left - current.right
      : direction === 'left'
        ? current.left - candidate.right
        : direction === 'down'
          ? candidate.top - current.bottom
          : current.top - candidate.bottom
  )
  const currentPerpendicularStart = horizontal ? current.top : current.left
  const currentPerpendicularEnd = horizontal ? current.bottom : current.right
  const candidatePerpendicularStart = horizontal ? candidate.top : candidate.left
  const candidatePerpendicularEnd = horizontal ? candidate.bottom : candidate.right
  const perpendicularGap = intervalGap(
    currentPerpendicularStart,
    currentPerpendicularEnd,
    candidatePerpendicularStart,
    candidatePerpendicularEnd
  )
  const perpendicularCenterDistance = Math.abs(
    (currentPerpendicularStart + currentPerpendicularEnd) / 2 -
      (candidatePerpendicularStart + candidatePerpendicularEnd) / 2
  )
  const offAxisPenalty = perpendicularGap > DIRECTION_EPSILON ? OFF_AXIS_ENTRY_PENALTY : 0

  return (
    primaryGap * 4 +
    primaryCenterDistance * 0.25 +
    perpendicularGap * 6 +
    perpendicularCenterDistance * 0.15 +
    offAxisPenalty
  )
}

function intervalGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): number {
  if (secondStart > firstEnd) return secondStart - firstEnd
  if (firstStart > secondEnd) return firstStart - secondEnd
  return 0
}

function centerX(rect: NavigationRect): number {
  return (rect.left + rect.right) / 2
}
function centerY(rect: NavigationRect): number {
  return (rect.top + rect.bottom) / 2
}

export function focusElement(
  el: HTMLElement | null,
  options: { ensureVisible?: boolean } = {}
): void {
  if (!el) return
  document
    .querySelectorAll('[data-focused="true"]')
    .forEach((n) => n.removeAttribute('data-focused'))
  el.setAttribute('data-focused', 'true')
  if (el.hasAttribute('data-application-nav-item')) {
    document
      .querySelectorAll('[data-application-last-focus="true"]')
      .forEach((node) => node.removeAttribute('data-application-last-focus'))
    el.setAttribute('data-application-last-focus', 'true')
  }
  el.focus({ preventScroll: true })
  if (options.ensureVisible !== false) ensureFocusedElementVisible(el)
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
  const activeScope = getActiveFocusScope()
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
