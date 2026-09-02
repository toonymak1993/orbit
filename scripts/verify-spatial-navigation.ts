import assert from 'node:assert/strict'
import {
  findNextFocus,
  moveFocus
} from '../src/renderer/src/lib/spatialNavigation.ts'

type NavigationLayer = 'top' | 'secondary' | 'content'

class FakeElement {
  readonly dataset: DOMStringMap = {} as DOMStringMap
  readonly offsetParent = {} as Element
  readonly parentElement = null
  readonly id: string
  readonly layer: NavigationLayer
  private readonly attributes = new Map<string, string>()
  private readonly rect: DOMRect

  constructor(id: string, layer: NavigationLayer, rect: DOMRect) {
    this.id = id
    this.layer = layer
    this.rect = rect
    this.attributes.set('data-focusable', '')
  }

  getBoundingClientRect(): DOMRect {
    return this.rect
  }

  closest(selector: string): Element | null {
    if (selector === '[data-top-nav]' && this.layer === 'top') return topNavRoot as unknown as Element
    if (selector === '[data-navigation-layer="secondary"]' && this.layer === 'secondary') {
      return this as unknown as Element
    }
    return null
  }

  matches(selector: string): boolean {
    if (selector === '[data-rolling-game="true"]') {
      return this.dataset.rollingGame === 'true'
    }
    if (selector === '[data-rolling-shelf-tab="true"]') {
      return this.dataset.rollingShelfTab === 'true'
    }
    if (selector === '[data-rolling-shelf-item="true"]') {
      return this.dataset.rollingShelfItem === 'true'
    }
    return false
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  focus(): void {
    activeElement = this
  }

  scrollIntoView(): void {}
}

class FakeTopNavRoot {
  children: FakeElement[] = []

  closest(): null {
    return null
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.includes('data-top-nav-last-focus')) {
      return this.children.find((item) => item.dataset.topNavLastFocus === 'true') ?? null
    }
    if (selector.includes('aria-current="page"')) {
      return this.children.find((item) => item.getAttribute('aria-current') === 'page') ?? null
    }
    if (selector.includes('data-main-view="home"')) {
      return this.children.find((item) => item.dataset.mainView === 'home') ?? null
    }
    return this.children[0] ?? null
  }
}

class FakeRollingRoot {
  children: FakeElement[] = []

  querySelector(selector: string): FakeElement | null {
    if (selector.includes('data-rolling-active')) {
      return this.children.find((item) => item.dataset.rollingActive === 'true') ?? null
    }
    if (selector.includes('data-rolling-shelf-tab') && selector.includes('aria-selected')) {
      return this.children.find(
        (item) =>
          item.dataset.rollingShelfTab === 'true' && item.getAttribute('aria-selected') === 'true'
      ) ?? null
    }
    if (selector.includes('data-rolling-shelf-tab')) {
      return this.children.find((item) => item.dataset.rollingShelfTab === 'true') ?? null
    }
    if (selector.includes('data-rolling-shelf-item')) {
      return this.children.find((item) => item.dataset.rollingShelfItem === 'true') ?? null
    }
    if (selector.includes('data-rolling-game')) {
      return this.children.find((item) => item.dataset.rollingGame === 'true') ?? null
    }
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector.includes('data-rolling-game')) {
      return this.children.filter((item) => item.dataset.rollingGame === 'true')
    }
    if (selector.includes('data-rolling-shelf-tab')) {
      return this.children.filter((item) => item.dataset.rollingShelfTab === 'true')
    }
    if (selector.includes('data-rolling-shelf-item')) {
      return this.children.filter((item) => item.dataset.rollingShelfItem === 'true')
    }
    return []
  }
}

function domRect(left: number, top: number, width = 80, height = 40): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  }
}

const topNavRoot = new FakeTopNavRoot()
const rollingRoot = new FakeRollingRoot()
let focusables: FakeElement[] = []
let activeElement: FakeElement | null = null
let rollingVisible = false

const fakeDocument = {
  get activeElement(): FakeElement | null {
    return activeElement
  },
  querySelector(selector: string): FakeTopNavRoot | FakeRollingRoot | null {
    if (selector === '[data-top-nav]' && topNavRoot.children.length > 0) return topNavRoot
    if (selector === '[data-home-layout="rolling"]' && rollingVisible) return rollingRoot
    return null
  },
  querySelectorAll(selector: string): FakeElement[] {
    if (selector === '[data-focused="true"]') {
      return focusables.filter((item) => item.getAttribute('data-focused') === 'true')
    }
    if (selector.includes('[data-focusable]')) return focusables
    return []
  }
}

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: fakeDocument
})

function setScene(elements: FakeElement[], current: FakeElement): void {
  focusables = elements
  topNavRoot.children = elements.filter((item) => item.layer === 'top')
  rollingRoot.children = []
  rollingVisible = false
  activeElement = current
}

function setRollingScene(
  topItems: FakeElement[],
  games: FakeElement[],
  current: FakeElement,
  tabs: FakeElement[] = [],
  shelfItems: FakeElement[] = []
): void {
  focusables = [...topItems, ...games, ...tabs, ...shelfItems]
  topNavRoot.children = topItems
  rollingRoot.children = [...games, ...tabs, ...shelfItems]
  rollingVisible = true
  activeElement = current
}

const top = new FakeElement('top', 'top', domRect(450, 20))
top.setAttribute('aria-current', 'page')
const secondary = new FakeElement('secondary', 'secondary', domRect(100, 95))
secondary.setAttribute('aria-pressed', 'true')
const contentAbove = new FakeElement('content-above', 'content', domRect(0, 180))
const contentCurrent = new FakeElement('content-current', 'content', domRect(450, 420))

setScene([top, secondary, contentAbove, contentCurrent], contentCurrent)
assert.equal(
  findNextFocus(contentCurrent as unknown as HTMLElement, 'up'),
  contentAbove,
  'Up must finish traversing page content before entering navigation chrome'
)

setScene([top, secondary, contentCurrent], contentCurrent)
assert.equal(
  findNextFocus(contentCurrent as unknown as HTMLElement, 'up'),
  secondary,
  'The active LT/RT tab must be the next layer above page content'
)
assert.equal(
  moveFocus('up', { allowNavigationLayerTransition: false }),
  false,
  'Held input must not cross from page content into the LT/RT layer'
)
assert.equal(activeElement, contentCurrent)
assert.equal(moveFocus('up'), true, 'A fresh Up press must enter the LT/RT layer')
assert.equal(activeElement, secondary)

assert.equal(
  moveFocus('up', { allowNavigationLayerTransition: false }),
  false,
  'Held input must not cross from the LT/RT layer into the top bar'
)
assert.equal(activeElement, secondary)
assert.equal(moveFocus('up'), true, 'A second fresh Up press must enter the top bar')
assert.equal(activeElement, top)

setScene([top, secondary, contentCurrent], top)
assert.equal(findNextFocus(top as unknown as HTMLElement, 'down'), secondary)
setScene([top, secondary, contentCurrent], secondary)
assert.equal(findNextFocus(secondary as unknown as HTMLElement, 'down'), contentCurrent)

const rollingGames = [0, 1, 2].map((index) => {
  const game = new FakeElement(`rolling-${index}`, 'content', domRect(80 + index * 140, 220))
  game.dataset.rollingGame = 'true'
  game.dataset.rollingIndex = String(index)
  if (index === 1) game.dataset.rollingActive = 'true'
  return game
})
const rollingTabs = [0, 1, 2].map((index) => {
  const tab = new FakeElement(`rolling-tab-${index}`, 'secondary', domRect(300 + index * 120, 610))
  tab.dataset.rollingShelfTab = 'true'
  tab.dataset.rollingShelfTabIndex = String(index)
  if (index === 0) tab.setAttribute('aria-selected', 'true')
  return tab
})
const rollingShelfItems = [0, 1, 2].map((index) => {
  const item = new FakeElement(`rolling-shelf-${index}`, 'content', domRect(80 + index * 240, 660, 210, 70))
  item.dataset.rollingShelfItem = 'true'
  item.dataset.rollingShelfItemIndex = String(index)
  return item
})

setRollingScene([top], rollingGames, rollingGames[1], rollingTabs, rollingShelfItems)
assert.equal(
  findNextFocus(rollingGames[1] as unknown as HTMLElement, 'right'),
  rollingGames[2],
  'Rolling Right must advance by stable library identity'
)
assert.equal(
  findNextFocus(rollingGames[2] as unknown as HTMLElement, 'right'),
  null,
  'Rolling Right must stop at the end of the track'
)
assert.equal(
  findNextFocus(rollingGames[0] as unknown as HTMLElement, 'left'),
  null,
  'Rolling Left must stop at the start of the track'
)
assert.equal(
  findNextFocus(rollingGames[1] as unknown as HTMLElement, 'left'),
  rollingGames[0],
  'Rolling Left must return to the previous library item'
)
assert.equal(
  findNextFocus(rollingGames[1] as unknown as HTMLElement, 'up'),
  top,
  'Rolling Up must return to the active top navigation item'
)
assert.equal(
  findNextFocus(top as unknown as HTMLElement, 'down'),
  rollingGames[1],
  'Top navigation Down must restore the active Rolling game'
)
assert.equal(
  findNextFocus(rollingGames[1] as unknown as HTMLElement, 'down'),
  rollingTabs[0],
  'Rolling game Down must enter the active discovery tab'
)
assert.equal(
  findNextFocus(rollingTabs[0] as unknown as HTMLElement, 'right'),
  rollingTabs[1],
  'Rolling discovery tabs must move in their visual order'
)
assert.equal(
  findNextFocus(rollingTabs[0] as unknown as HTMLElement, 'up'),
  rollingGames[1],
  'Rolling discovery Up must restore the active game'
)
assert.equal(
  findNextFocus(rollingTabs[0] as unknown as HTMLElement, 'down'),
  rollingShelfItems[0],
  'Rolling discovery Down must enter its first content item'
)
assert.equal(
  findNextFocus(rollingShelfItems[1] as unknown as HTMLElement, 'left'),
  rollingShelfItems[0],
  'Rolling shelf items must move in their visual order'
)
assert.equal(
  findNextFocus(rollingShelfItems[1] as unknown as HTMLElement, 'up'),
  rollingTabs[0],
  'Rolling shelf Up must return to the active discovery tab'
)

console.log('Spatial navigation hierarchy, Rolling track, and discovery shelf checks passed.')
