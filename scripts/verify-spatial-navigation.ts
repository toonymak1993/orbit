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

  matches(): boolean {
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
let focusables: FakeElement[] = []
let activeElement: FakeElement | null = null

const fakeDocument = {
  get activeElement(): FakeElement | null {
    return activeElement
  },
  querySelector(selector: string): FakeTopNavRoot | null {
    if (selector === '[data-top-nav]' && topNavRoot.children.length > 0) return topNavRoot
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

console.log('Spatial navigation hierarchy checks passed.')
