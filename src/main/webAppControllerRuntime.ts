import type { MediaDirection } from './mediaControllerBridge'
import type { MediaKeyboardOpenPayload, MediaKeyboardUpdatePayload } from '@shared/ipc'

export type WebAppControllerAction =
  | { type: 'direction'; direction: MediaDirection }
  | { type: 'confirm' }
  | { type: 'search' }
  | { type: 'play-pause' }
  | { type: 'history'; delta: -1 | 1 }
  | { type: 'back-context' }
  | { type: 'back-fallback'; previousUrl: string }

export interface WebAppControllerConfig {
  allowedHostSuffixes: string[]
  searchTerms: string[]
  searchPathHints: string[]
  panelSelectors?: string[]
  playerSelectors?: string[]
  playerControlSelectors?: string[]
  playerInitialFocusSelectors?: string[]
}

export interface WebAppEditableResult {
  fieldToken: string
  value: string
  selectionStart: number
  selectionEnd: number
  inputType: MediaKeyboardOpenPayload['inputType']
  label?: string
  maxLength?: number
}

export interface WebAppActionResult {
  blocked?: boolean
  editable?: WebAppEditableResult
  needsPlayerControls?: boolean
  nativeKey?: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp'
  pointerWake?: { x: number; y: number }
  backContext?: {
    hasDialog: boolean
    hasVideo: boolean
    url: string
  }
}

/**
 * Provider-neutral spatial controller runtime. It deliberately receives a
 * narrow host/search configuration so future ORBIT web apps can reuse the
 * navigation model without inheriting Netflix-specific selectors or trust.
 */
export const WEB_APP_CONTROLLER_RUNTIME = String.raw`
(async ({ action, config }) => {
  const host = location.hostname.toLowerCase()
  const trusted = location.protocol === 'https:' && config.allowedHostSuffixes.some((suffix) => {
    const normalized = String(suffix || '').toLowerCase()
    return normalized && (host === normalized || host.endsWith('.' + normalized))
  })
  if (!trusted) return { blocked: true }

  const focusAttribute = 'data-orbit-media-focus'
  const keyboardTokenAttribute = 'data-orbit-keyboard-token'
  const controllerModeAttribute = 'data-orbit-controller-mode'
  const styleId = 'orbit-media-controller-style'
  const editableSelector = 'input:not([disabled]), textarea:not([disabled])'
  const semanticFocusableSelector = [
    'a[href]',
    'button:not([disabled])',
    editableSelector,
    'select:not([disabled])',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="slider"]',
    '[role="tab"]'
  ].join(',')
  const focusableSelector = [
    semanticFocusableSelector,
    '[tabindex]:not([tabindex="-1"])'
  ].join(',')
  const state = window.__orbitWebControllerState || {
    lastRect: null,
    lastUrl: location.href,
    scopeRoot: document.documentElement,
    scopeFocus: new WeakMap()
  }
  window.__orbitWebControllerState = state
  if (!(state.scopeRoot instanceof Element)) state.scopeRoot = document.documentElement
  if (!(state.scopeFocus instanceof WeakMap)) state.scopeFocus = new WeakMap()
  if (state.lastUrl !== location.href) {
    state.lastUrl = location.href
    state.lastRect = null
    state.scopeRoot = document.documentElement
    state.scopeFocus = new WeakMap()
  }

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent =
      '[' + focusAttribute + '="true"]{' +
      'outline:3px solid #36d6ff!important;' +
      'outline-offset:4px!important;' +
      'box-shadow:0 0 0 2px rgba(0,0,0,.78),0 0 26px rgba(54,214,255,.76)!important}' +
      'html[' + controllerModeAttribute + '="true"],html[' + controllerModeAttribute + '="true"] *{' +
      'cursor:none!important}'
    document.documentElement.appendChild(style)
  }
  if (!state.pointerModeListenerInstalled) {
    const restorePointer = () => document.documentElement.removeAttribute(controllerModeAttribute)
    window.addEventListener('mousemove', restorePointer, { capture: true, passive: true })
    window.addEventListener('pointerdown', restorePointer, { capture: true, passive: true })
    state.pointerModeListenerInstalled = true
  }
  document.documentElement.setAttribute(controllerModeAttribute, 'true')

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement) || element.closest('[inert]')) return false
    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false
    if (element.getAttribute('aria-hidden') === 'true') return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 3 && rect.height > 3 &&
      rect.right > -12 && rect.bottom > -12 && rect.left < innerWidth + 12 && rect.top < innerHeight + 12 &&
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.02
  }
  const isVisibleContainer = (element) => {
    if (!(element instanceof HTMLElement) || element.closest('[inert]')) return false
    if (element.getAttribute('aria-hidden') === 'true') return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 24 && rect.height > 24 && rect.right > 0 && rect.bottom > 0 &&
      rect.left < innerWidth && rect.top < innerHeight && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.02
  }
  const safeMatches = (element, selector) => {
    try { return element.matches(selector) } catch { return false }
  }
  const hasVisibleAncestors = (element, boundary = document.documentElement) => {
    let current = element
    while (current instanceof HTMLElement) {
      const style = getComputedStyle(current)
      if (current.closest('[inert]') || current.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.02) {
        return false
      }
      if (current === boundary) return true
      current = current.parentElement
    }
    return boundary === document.documentElement
  }
  const video = document.querySelector('video')
  const videoRect = video instanceof HTMLVideoElement ? video.getBoundingClientRect() : null
  const playerActive = Boolean(
    document.fullscreenElement ||
    location.pathname.startsWith('/watch/') ||
    (videoRect && videoRect.width > innerWidth * 0.72 && videoRect.height > innerHeight * 0.62)
  )
  const playerSelectors = Array.isArray(config.playerSelectors) ? config.playerSelectors : []
  let playerRoot = null
  if (playerActive && video instanceof HTMLVideoElement) {
    for (const selector of playerSelectors) {
      try {
        const match = Array.from(document.querySelectorAll(selector)).find((element) =>
          element instanceof HTMLElement && element.contains(video) && isVisibleContainer(element)
        )
        if (match) {
          playerRoot = match
          break
        }
      } catch {
        // Ignore invalid provider configuration and keep the generic fallback.
      }
    }
    if (!playerRoot) {
      const fallback = video.closest('[data-uia="watch-video"], .watch-video, [data-uia="player"]')
      if (fallback instanceof HTMLElement && isVisibleContainer(fallback)) playerRoot = fallback
    }
  }
  const panelSelectors = [
    ':modal',
    'dialog[open]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    ...(Array.isArray(config.panelSelectors) ? config.panelSelectors : [])
  ].filter((selector) => typeof selector === 'string' && selector.trim())
  const activeScope = () => {
    const candidates = []
    for (const selector of panelSelectors) {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          if (!candidates.includes(element) && isVisibleContainer(element)) candidates.push(element)
        })
      } catch {
        // A provider-specific selector must never break all controller input.
      }
    }
    if (!candidates.length) return document.documentElement
    const viewportArea = Math.max(1, innerWidth * innerHeight)
    return candidates.reduce((best, candidate, index) => {
      const rect = candidate.getBoundingClientRect()
      const style = getComputedStyle(candidate)
      const parsedZIndex = Number.parseInt(style.zIndex, 10)
      const zIndex = Number.isFinite(parsedZIndex) ? Math.max(-10_000, Math.min(100_000, parsedZIndex)) : 0
      const semanticWeight = safeMatches(candidate, ':modal') ? 3 :
        safeMatches(candidate, 'dialog[open], [aria-modal="true"]') ? 2 :
          safeMatches(candidate, '[role="dialog"]') ? 1 : 0
      const visibleArea = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) *
        Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0))
      const score = semanticWeight * 1_000_000_000 + zIndex * 10_000 +
        Math.min(1, visibleArea / viewportArea) * 1_000 + index
      return !best || score > best.score ? { element: candidate, score } : best
    }, null)?.element || document.documentElement
  }
  const panelScope = activeScope()
  const scopeRoot = panelScope !== document.documentElement
    ? panelScope
    : playerRoot || document.documentElement
  const previousScope = state.scopeRoot
  if (previousScope !== scopeRoot) {
    const marked = document.querySelector('[' + focusAttribute + '="true"]')
    if (marked instanceof HTMLElement && previousScope.contains(marked) && isVisible(marked)) {
      state.scopeFocus.set(previousScope, marked)
    }
    document.querySelectorAll('[' + focusAttribute + ']').forEach((item) => item.removeAttribute(focusAttribute))
    state.scopeRoot = scopeRoot
    state.lastRect = null
  }
  const sameBox = (a, b) => {
    const ar = a.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    const overlapWidth = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left))
    const overlapHeight = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top))
    const overlap = overlapWidth * overlapHeight
    const areaA = Math.max(1, ar.width * ar.height)
    const areaB = Math.max(1, br.width * br.height)
    const smaller = Math.min(areaA, areaB)
    const sizeSimilarity = smaller / Math.max(areaA, areaB)
    return overlap / smaller > 0.82 && sizeSimilarity > 0.55
  }
  const focusables = () => {
    const raw = Array.from(scopeRoot.querySelectorAll(focusableSelector)).filter((element) =>
      isVisible(element) && hasVisibleAncestors(element, scopeRoot)
    )
    const withoutStructuralWrappers = raw.filter((element) => {
      if (element.matches(semanticFocusableSelector)) return true
      const rect = element.getBoundingClientRect()
      const coversViewport = rect.width * rect.height > innerWidth * innerHeight * 0.32
      return !coversViewport || !raw.some((candidate) => candidate !== element && element.contains(candidate))
    })
    return withoutStructuralWrappers.filter((element) => !withoutStructuralWrappers.some((ancestor) =>
      ancestor !== element && ancestor.contains(element) && sameBox(ancestor, element)
    ))
  }
  const selected = (elements = focusables()) => {
    const marked = document.querySelector('[' + focusAttribute + '="true"]')
    if (marked instanceof HTMLElement && elements.includes(marked) && isVisible(marked)) return marked
    return document.activeElement instanceof HTMLElement && isVisible(document.activeElement) &&
      elements.includes(document.activeElement) && document.activeElement.matches(focusableSelector)
      ? document.activeElement
      : elements.includes(state.scopeFocus.get(scopeRoot)) ? state.scopeFocus.get(scopeRoot) : null
  }
  const center = (rect) => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  })
  const remember = (element) => {
    const rect = element.getBoundingClientRect()
    state.lastRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    state.scopeFocus.set(scopeRoot, element)
  }
  const select = (element) => {
    document.querySelectorAll('[' + focusAttribute + ']').forEach((item) => item.removeAttribute(focusAttribute))
    element.setAttribute(focusAttribute, 'true')
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    remember(element)
  }
  const initialCandidate = (elements) => {
    if (!elements.length) return null
    if (playerActive && scopeRoot === playerRoot) {
      for (const selector of Array.isArray(config.playerInitialFocusSelectors)
        ? config.playerInitialFocusSelectors
        : []) {
        try {
          const preferred = elements.find((element) => element.matches(selector))
          if (preferred) return preferred
        } catch {
          // Fall through to spatial selection for invalid provider selectors.
        }
      }
    }
    const target = state.lastRect
      ? center(state.lastRect)
      : { x: innerWidth / 2, y: innerHeight * 0.48 }
    return elements.reduce((best, candidate) => {
      const point = center(candidate.getBoundingClientRect())
      const score = Math.hypot(point.x - target.x, point.y - target.y)
      return !best || score < best.score ? { element: candidate, score } : best
    }, null)?.element || null
  }
  const perpendicularOverlap = (origin, candidate, horizontal) => horizontal
    ? Math.min(origin.bottom, candidate.bottom) - Math.max(origin.top, candidate.top) > 0
    : Math.min(origin.right, candidate.right) - Math.max(origin.left, candidate.left) > 0
  const directionalCandidate = (elements, current, direction) => {
    const origin = current.getBoundingClientRect()
    const from = center(origin)
    const horizontal = direction === 'left' || direction === 'right'
    let winner = null
    let winnerScore = Number.POSITIVE_INFINITY
    for (const candidate of elements) {
      if (candidate === current) continue
      const rect = candidate.getBoundingClientRect()
      const point = center(rect)
      const dx = point.x - from.x
      const dy = point.y - from.y
      const primary = direction === 'left' ? -dx : direction === 'right' ? dx :
        direction === 'up' ? -dy : dy
      if (primary <= 5) continue
      const secondary = horizontal ? Math.abs(dy) : Math.abs(dx)
      const beamPenalty = perpendicularOverlap(origin, rect, horizontal)
        ? 0
        : (horizontal ? innerHeight : innerWidth) * 0.72
      const score = primary + secondary * 2.45 + Math.hypot(dx, dy) * 0.08 + beamPenalty
      if (score < winnerScore) {
        winner = candidate
        winnerScore = score
      }
    }
    return winner
  }
  const scrollForDirection = (current, direction) => {
    const horizontal = direction === 'left' || direction === 'right'
    let candidate = current
    while (candidate && candidate !== document.documentElement) {
      const style = getComputedStyle(candidate)
      const overflow = horizontal ? style.overflowX : style.overflowY
      const hasRoom = horizontal
        ? candidate.scrollWidth > candidate.clientWidth + 4
        : candidate.scrollHeight > candidate.clientHeight + 4
      if (hasRoom && /(auto|scroll)/.test(overflow)) {
        candidate.scrollBy({
          left: horizontal ? (direction === 'left' ? -1 : 1) * candidate.clientWidth * 0.72 : 0,
          top: horizontal ? 0 : (direction === 'up' ? -1 : 1) * candidate.clientHeight * 0.72,
          behavior: 'smooth'
        })
        return true
      }
      if (candidate === scopeRoot) break
      candidate = candidate.parentElement
    }
    if (scopeRoot !== document.documentElement) return false
    const scrolling = document.scrollingElement
    if (!scrolling) return false
    const before = horizontal ? scrolling.scrollLeft : scrolling.scrollTop
    window.scrollBy({
      left: horizontal ? (direction === 'left' ? -1 : 1) * innerWidth * 0.72 : 0,
      top: horizontal ? 0 : (direction === 'up' ? -1 : 1) * innerHeight * 0.72,
      behavior: 'smooth'
    })
    const after = horizontal ? scrolling.scrollLeft : scrolling.scrollTop
    return before !== after ||
      (horizontal ? scrolling.scrollWidth > scrolling.clientWidth : scrolling.scrollHeight > scrolling.clientHeight)
  }
  const editable = (element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  const editableResult = (element) => {
    if (!editable(element)) return null
    let token = element.getAttribute(keyboardTokenAttribute)
    if (!token) {
      token = crypto.randomUUID()
      element.setAttribute(keyboardTokenAttribute, token)
    }
    const rawType = element instanceof HTMLTextAreaElement ? 'text' : String(element.type || 'text').toLowerCase()
    const acceptedTypes = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url'])
    const inputType = acceptedTypes.has(rawType) ? rawType : 'text'
    const safeValue = inputType === 'password' ? '' : element.value
    const fallback = safeValue.length
    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
      : ''
    const label = element.getAttribute('aria-label') || labelledText || element.placeholder || undefined
    return {
      fieldToken: token,
      value: safeValue,
      selectionStart: inputType === 'password' ? 0 : Math.min(element.selectionStart ?? fallback, fallback),
      selectionEnd: inputType === 'password' ? 0 : Math.min(element.selectionEnd ?? fallback, fallback),
      inputType,
      label,
      maxLength: element.maxLength > 0 ? element.maxLength : undefined
    }
  }

  const playerControlsVisible = !playerActive || !playerRoot ||
    (Array.isArray(config.playerControlSelectors) ? config.playerControlSelectors : []).some((selector) => {
      try {
        return Array.from(playerRoot.querySelectorAll(selector)).some((element) =>
          isVisible(element) && hasVisibleAncestors(element, playerRoot)
        )
      } catch {
        return false
      }
    })
  if (
    playerActive &&
    playerRoot &&
    (action.type === 'direction' || action.type === 'confirm') &&
    !playerControlsVisible
  ) {
    return {
      needsPlayerControls: true,
      pointerWake: { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) }
    }
  }

  if (action.type === 'direction') {
    let elements = focusables()
    if (!elements.length) return {}
    const current = selected(elements)
    if (!current || !elements.includes(current)) {
      const initial = initialCandidate(elements)
      if (initial) select(initial)
      return {}
    }
    if (
      playerActive &&
      (action.direction === 'left' || action.direction === 'right') &&
      current.matches('[role="slider"], input[type="range"]')
    ) {
      select(current)
      return { nativeKey: action.direction === 'left' ? 'ArrowLeft' : 'ArrowRight' }
    }
    let winner = directionalCandidate(elements, current, action.direction)
    if (!winner && scrollForDirection(current, action.direction)) {
      await new Promise((resolve) => setTimeout(resolve, 180))
      elements = focusables()
      winner = directionalCandidate(elements, current, action.direction)
    }
    if (winner) select(winner)
    else select(current)
    return {}
  }

  if (action.type === 'confirm') {
    const elements = focusables()
    const current = selected(elements)
    if (!current) {
      const initial = initialCandidate(elements)
      if (initial) select(initial)
      return {}
    }
    select(current)
    const field = editableResult(current)
    if (field) return { editable: field }
    current.click()
    return {}
  }

  if (action.type === 'search') {
    const terms = config.searchTerms.map((term) => String(term).toLowerCase()).filter(Boolean)
    const pathHints = config.searchPathHints.map((hint) => String(hint).toLowerCase()).filter(Boolean)
    const includesSearchTerm = (value) => {
      const normalized = String(value || '').toLowerCase()
      return terms.some((term) => normalized.includes(term))
    }
    const locateSearchInput = () => Array.from(scopeRoot.querySelectorAll(editableSelector)).find((element) => {
      if (!isVisible(element)) return false
      if (element.matches('input[type="search"], [role="searchbox"]')) return true
      return includesSearchTerm([
        element.getAttribute('data-uia'), element.getAttribute('aria-label'),
        element.placeholder, element.name
      ].filter(Boolean).join(' '))
    })
    let input = locateSearchInput()
    if (!input) {
      const trigger = focusables().find((element) => {
        const href = String(element.getAttribute('href') || '').toLowerCase()
        if (pathHints.some((hint) => href.includes(hint))) return true
        return includesSearchTerm([
          element.getAttribute('data-uia'), element.getAttribute('aria-label'),
          element.getAttribute('title'), element.textContent
        ].filter(Boolean).join(' '))
      })
      if (trigger) {
        select(trigger)
        trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 420))
        input = locateSearchInput()
      }
    }
    if (input) {
      select(input)
      return { editable: editableResult(input) }
    }
    return {}
  }

  if (action.type === 'play-pause') {
    const scopedVideo = scopeRoot.querySelector('video')
    if (scopedVideo instanceof HTMLVideoElement) {
      if (scopedVideo.paused) await scopedVideo.play().catch(() => undefined)
      else scopedVideo.pause()
    }
    return {}
  }

  if (action.type === 'back-context') {
    return {
      backContext: {
        hasDialog: scopeRoot !== document.documentElement,
        hasVideo: playerActive,
        url: location.href
      }
    }
  }

  if (action.type === 'back-fallback') {
    if (location.href === action.previousUrl) history.back()
    return {}
  }

  if (action.type === 'history') {
    history.go(action.delta)
    return {}
  }
  return {}
})
`

export function webAppActionExpression(
  config: WebAppControllerConfig,
  action: WebAppControllerAction
): string {
  return `${WEB_APP_CONTROLLER_RUNTIME}(${JSON.stringify({ action, config })})`
}

export function webAppInputUpdateExpression(
  config: WebAppControllerConfig,
  fieldToken: string,
  update: MediaKeyboardUpdatePayload
): string {
  return String.raw`
    (() => {
      const host = location.hostname.toLowerCase()
      const allowedHosts = ${JSON.stringify(config.allowedHostSuffixes)}
      const trusted = location.protocol === 'https:' && allowedHosts.some((suffix) =>
        host === suffix || host.endsWith('.' + suffix)
      )
      if (!trusted) return false
      const selector = '[data-orbit-keyboard-token="' + CSS.escape(${JSON.stringify(fieldToken)}) + '"]'
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return false
      const value = ${JSON.stringify(update.value)}
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      if (setter) setter.call(element, value)
      else element.value = value
      element.setSelectionRange(${update.selectionStart}, ${update.selectionEnd})
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }))
      return true
    })()
  `
}
