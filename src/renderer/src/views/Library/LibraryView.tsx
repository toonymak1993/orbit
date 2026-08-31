import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ChevronLeft,
  CircleAlert,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Gamepad2,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useLibraryStore } from '@renderer/state/libraryStore'
import {
  ALL_LIBRARY_CATEGORIES,
  LIBRARY_SOURCE_ORDER,
  collectionIdFromLibrarySource,
  collectionLibrarySource,
  useLibraryFilterStore,
  type LibrarySortOrder,
  type LibrarySource
} from '@renderer/state/libraryFilterStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { usePlayStationStore } from '@renderer/state/playstationStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { GameCard } from '@renderer/components/GameCard'
import { LibraryProviderBadge } from '@renderer/components/LibraryProviderBadge'
import { LibrarySelect, type LibrarySelectOption } from '@renderer/components/LibrarySelect'
import { RetroSystemHub } from '@renderer/components/RetroSystemHub'
import { RetroSystemEmulatorDialog } from '@renderer/components/RetroSystemEmulatorDialog'
import { CustomGameWizard } from '@renderer/components/CustomGameWizard'
import { RetroLibraryDialog } from '@renderer/components/RetroLibraryDialog'
import {
  DeleteLibraryConfirmationDialog,
  LibraryCollectionDialog
} from '@renderer/components/LibraryCollectionDialog'
import { ControllerButtonHint } from '@renderer/components/ControllerButtonHint'
import { RETRO_SYSTEM_ARTWORK } from '@renderer/assets/retroSystemArtwork'
import { useExpandableViewSearch } from '@renderer/hooks/useExpandableViewSearch'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { LIBRARY_SEARCH_EVENT } from '@renderer/lib/librarySearch'
import {
  RETRO_SYSTEM_SWAY_LOOP,
  RETRO_SYSTEM_SWAY_OFFSET,
  RETRO_SYSTEM_SWAY_ROTATION
} from '@renderer/lib/retroSystemMotion'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'

import { shouldShowSteamSyncNotice } from '@shared/steamSyncPolicy'
import { retroSystemById } from '@shared/retroSystems'
import type {
  GameCollection,
  GameProvider,
  LibraryGame,
  RetroLibraryStatus,
  RetroSystemId
} from '@shared/ipc'

const INITIAL_RENDER_LIMIT = 30
const RENDER_BATCH_SIZE = 18

function libraryProviderFromSource(source: LibrarySource): GameProvider | null {
  if (source === 'favorites' || source === 'all' || source.startsWith('collection:')) return null
  return source as GameProvider
}

function LibrarySourceMark({
  source,
  active
}: {
  source: LibrarySource
  active: boolean
}): JSX.Element {
  const provider = libraryProviderFromSource(source)
  if (provider) {
    return (
      <LibraryProviderBadge
        provider={provider}
        size="compact"
        className={`transition-transform duration-150 ${active ? 'scale-105' : 'opacity-80'}`}
      />
    )
  }

  const Icon = source === 'favorites' ? Star : source === 'all' ? LayoutGrid : Folder
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.56rem] border transition-colors ${
        active
          ? 'border-accent/45 bg-accent/15 text-accent'
          : 'border-white/15 bg-white/[0.07] text-white/55'
      }`}
    >
      <Icon size={15} fill={source === 'favorites' && active ? 'currentColor' : 'none'} />
    </span>
  )
}

function RetroSystemMark({ systemId }: { systemId: RetroSystemId }): JSX.Element {
  const reduceMotion = Boolean(useReducedMotion())

  return (
    <div aria-hidden="true" className="relative flex h-16 w-20 shrink-0 items-center justify-center">
      <div className="absolute h-10 w-14 rounded-full bg-accent/15 blur-xl" />
      <motion.img
        key={systemId}
        src={RETRO_SYSTEM_ARTWORK[systemId]}
        alt=""
        draggable={false}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
        animate={
          reduceMotion
            ? { opacity: 1, rotate: 0, scale: 1, x: 0 }
            : {
                opacity: 1,
                rotate: RETRO_SYSTEM_SWAY_ROTATION,
                scale: 1,
                x: RETRO_SYSTEM_SWAY_OFFSET
              }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                opacity: { duration: 0.24 },
                rotate: RETRO_SYSTEM_SWAY_LOOP,
                scale: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                x: RETRO_SYSTEM_SWAY_LOOP
              }
        }
        className="relative h-full w-full origin-bottom object-contain drop-shadow-[0_10px_14px_rgba(0,0,0,0.5)]"
      />
    </div>
  )
}

function normalizeLibraryCategory(category: string): string {
  return category.trim().toLocaleLowerCase()
}

function libraryPlaytimeSeconds(game: LibraryGame): number {
  return game.playtimeSeconds ?? (game.playtimeMinutes ?? 0) * 60
}

function libraryLastPlayedAt(game: LibraryGame): number {
  return Math.max(game.lastPlayedTimestamp ?? 0, game.lastStartedAt ?? 0)
}

function compareLibraryGames(
  left: LibraryGame,
  right: LibraryGame,
  sortOrder: LibrarySortOrder,
  collator: Intl.Collator
): number {
  if (sortOrder === 'installed-first') {
    const installedDifference = Number(right.installed) - Number(left.installed)
    if (installedDifference !== 0) return installedDifference
  }
  if (sortOrder === 'recently-played') {
    const lastPlayedDifference = libraryLastPlayedAt(right) - libraryLastPlayedAt(left)
    if (lastPlayedDifference !== 0) return lastPlayedDifference
  }
  if (sortOrder === 'most-played') {
    const playtimeDifference = libraryPlaytimeSeconds(right) - libraryPlaytimeSeconds(left)
    if (playtimeDifference !== 0) return playtimeDifference
  }

  const titleDifference = collator.compare(left.name, right.name)
  return sortOrder === 'title-descending' ? -titleDifference : titleDifference
}

export function LibraryView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const reduceMotion = Boolean(useReducedMotion())
  const account = useAuthStore((s) => s.account)
  const epicAccount = useEpicAuthStore((s) => s.account)
  const playStationAccount = usePlayStationStore((s) => s.account)
  const { games, providerGames, isLoadingMetadata, loadedAt, providerStatuses } = useLibraryStore(
    (s) => s.snapshot
  )
  const isRefreshing = useLibraryStore((s) => s.isRefreshing)
  const refreshLibrary = useLibraryStore((s) => s.refresh)
  const applySnapshot = useLibraryStore((s) => s.applySnapshot)
  const source = useLibraryFilterStore((s) => s.source)
  const setSource = useLibraryFilterStore((s) => s.setSource)
  const sortOrder = useLibraryFilterStore((s) => s.sortOrder)
  const setSortOrder = useLibraryFilterStore((s) => s.setSortOrder)
  const category = useLibraryFilterStore((s) => s.category)
  const setCategory = useLibraryFilterStore((s) => s.setCategory)
  const setCollectionIds = useLibraryFilterStore((s) => s.setCollectionIds)
  const isActive = useNavigationStore((s) => s.mainView === 'library')
  const gridColumns = usePreferencesStore((s) => s.libraryGridColumns)
  const language = usePreferencesStore((s) => s.language)
  const retroSystemColumns = Math.min(5, Math.max(3, gridColumns))
  const favoriteGameIds = useLibraryCollectionsStore((s) => s.favoriteGameIds)
  const collections = useLibraryCollectionsStore((s) => s.collections)
  const preloadCardThreshold = gridColumns * 2
  const [query, setQuery] = useState('')
  const [showCustomWizard, setShowCustomWizard] = useState(false)
  const [showRetroLibrary, setShowRetroLibrary] = useState(false)
  const [activeRetroSystem, setActiveRetroSystem] = useState<RetroSystemId | null>(null)
  const [showRetroEmulator, setShowRetroEmulator] = useState(false)
  const [configuredRetroEmulatorName, setConfiguredRetroEmulatorName] = useState<string | null>(
    null
  )
  const [retroSystemStatus, setRetroSystemStatus] = useState<RetroLibraryStatus | null>(null)
  const [retroFolderBusy, setRetroFolderBusy] = useState(false)
  const [retroSetupBusy, setRetroSetupBusy] = useState(false)
  const [retroSetupCanceling, setRetroSetupCanceling] = useState(false)
  const [retroSystemError, setRetroSystemError] = useState<string | null>(null)
  const [retroSystemNotice, setRetroSystemNotice] = useState<string | null>(null)
  const [showCollectionDialog, setShowCollectionDialog] = useState(false)
  const [collectionPendingDeletion, setCollectionPendingDeletion] =
    useState<GameCollection | null>(null)
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT)
  const sourceStripRef = useRef<HTMLDivElement>(null)
  const collectionButtonRef = useRef<HTMLButtonElement>(null)
  const deleteCollectionButtonRef = useRef<HTMLButtonElement>(null)
  const retroEmulatorButtonRef = useRef<HTMLButtonElement>(null)
  const retroSetupCancelRequestedRef = useRef(false)
  const activeRetroSystemRef = useRef<RetroSystemId | null>(activeRetroSystem)
  activeRetroSystemRef.current = activeRetroSystem
  const restoreRetroSystemRef = useRef<RetroSystemId | null>(null)
  const revealLockedRef = useRef(false)
  const revealUnlockTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const t = useT()
  const sortOptions: LibrarySelectOption<LibrarySortOrder>[] = [
    { value: 'installed-first', label: t('library.sort.installedFirst') },
    { value: 'title-ascending', label: t('library.sort.titleAscending') },
    { value: 'title-descending', label: t('library.sort.titleDescending') },
    { value: 'recently-played', label: t('library.sort.recentlyPlayed') },
    { value: 'most-played', label: t('library.sort.mostPlayed') }
  ]
  const titleCollator = useMemo(
    () => new Intl.Collator(language, { numeric: true, sensitivity: 'base' }),
    [language]
  )
  const {
    expanded: searchExpanded,
    inputRef: searchRef,
    expand: expandSearch,
    collapse: collapseSearch
  } = useExpandableViewSearch({
    active: isActive,
    containerRef,
    eventName: LIBRARY_SEARCH_EVENT,
    onCollapse: () => setQuery('')
  })
  const steamStatus = providerStatuses?.find((status) => status.provider === 'steam')
  const showSteamSyncNotice = Boolean(
    account &&
      (source === 'all' || source === 'steam') &&
      shouldShowSteamSyncNotice(steamStatus)
  )
  const steamSyncMessage =
    steamStatus?.issue === 'metadata-pending'
      ? t('library.sync.pending', { count: steamStatus.pendingCount ?? 0 })
      : steamStatus?.issue === 'online-library-unavailable' ||
          steamStatus?.issue === 'no-games-found'
        ? t('library.sync.visibility')
        : t('library.sync.partial')

  const availableGames = useMemo(() => {
    const byId = new Map(games.map((game) => [game.id, game]))
    for (const game of providerGames) {
      if (!byId.has(game.id)) byId.set(game.id, game)
    }
    return [...byId.values()]
  }, [games, providerGames])

  const favoriteIds = useMemo(() => new Set(favoriteGameIds), [favoriteGameIds])
  const activeCollectionId = collectionIdFromLibrarySource(source)
  const activeCollection = activeCollectionId
    ? collections.find((collection) => collection.id === activeCollectionId)
    : undefined

  const retroGames = useMemo(
    () => providerGames.filter((game) => game.provider === 'retro'),
    [providerGames]
  )
  const activeRetroGames = useMemo(
    () =>
      activeRetroSystem
        ? retroGames.filter((game) => game.retro?.systemId === activeRetroSystem)
        : [],
    [activeRetroSystem, retroGames]
  )

  useEffect(() => {
    let active = true
    if (source !== 'retro' || !activeRetroSystem) {
      setConfiguredRetroEmulatorName(null)
      setRetroSystemStatus(null)
      setRetroSystemError(null)
      setRetroSystemNotice(null)
      return () => {
        active = false
      }
    }
    setRetroFolderBusy(true)
    setRetroSystemError(null)
    void window.api.library.retro
      .ensureSystemDirectory(activeRetroSystem)
      .catch(() => {
        if (active) setRetroSystemError(t('retro.folder.error'))
      })
      .finally(() => {
        if (active) setRetroFolderBusy(false)
      })
    void Promise.all([window.api.settings.get(), window.api.library.retro.getStatus()])
      .then(([settings, status]) => {
        if (!active) return
        const configuredId = settings.retroSystemEmulators?.[activeRetroSystem]
        const emulator = status.emulators.find((candidate) => candidate.id === configuredId)
        setRetroSystemStatus(status)
        setConfiguredRetroEmulatorName(configuredId ? emulator?.name ?? configuredId : null)
      })
      .catch(() => {
        if (active) {
          setRetroSystemStatus(null)
          setConfiguredRetroEmulatorName(null)
        }
      })
    return () => {
      active = false
    }
  }, [activeRetroSystem, source, t])

  const hasReadyRetroEmulator = Boolean(
    activeRetroSystem &&
      retroSystemStatus?.emulators.some((emulator) =>
        emulator.readySystems.includes(activeRetroSystem)
      )
  )

  const openActiveRetroFolder = useCallback(async (): Promise<void> => {
    if (!activeRetroSystem || retroFolderBusy) return
    setRetroFolderBusy(true)
    setRetroSystemError(null)
    try {
      await window.api.library.retro.openSystemDirectory(activeRetroSystem)
    } catch {
      setRetroSystemError(t('retro.folder.error'))
    } finally {
      setRetroFolderBusy(false)
    }
  }, [activeRetroSystem, retroFolderBusy, t])

  const setupActiveRetroSystem = useCallback(async (): Promise<void> => {
    if (!activeRetroSystem || retroSetupBusy) return
    setRetroSetupBusy(true)
    retroSetupCancelRequestedRef.current = false
    setRetroSystemError(null)
    setRetroSystemNotice(null)
    try {
      const result = await window.api.library.retro.installEmulator({
        systemId: activeRetroSystem
      })
      if (activeRetroSystemRef.current !== activeRetroSystem) return
      applySnapshot(result.snapshot)
      setRetroSystemStatus(result.status)
      setConfiguredRetroEmulatorName(result.emulatorName)
      setRetroSystemNotice(
        result.alreadyInstalled
          ? t('retro.setup.alreadyInstalled', { emulator: result.emulatorName })
          : result.emulatorInstalled
            ? result.firmwareMayBeRequired
              ? t('retro.setup.installedWithFirmware', { emulator: result.emulatorName })
              : t('retro.setup.installed', { emulator: result.emulatorName })
            : result.firmwareMayBeRequired
              ? t('retro.setup.coreInstalledWithFirmware', { emulator: result.emulatorName })
              : t('retro.setup.coreInstalled', { emulator: result.emulatorName })
      )
    } catch {
      if (retroSetupCancelRequestedRef.current) {
        setRetroSystemNotice(t('retro.setup.canceled'))
      } else {
        setRetroSystemError(t('retro.setup.installError'))
      }
    } finally {
      retroSetupCancelRequestedRef.current = false
      setRetroSetupCanceling(false)
      setRetroSetupBusy(false)
    }
  }, [activeRetroSystem, applySnapshot, retroSetupBusy, t])

  const cancelActiveRetroSetup = useCallback(async (): Promise<void> => {
    if (!retroSetupBusy || retroSetupCanceling) return
    retroSetupCancelRequestedRef.current = true
    setRetroSetupCanceling(true)
    setRetroSystemNotice(t('retro.setup.canceling'))
    await window.api.library.retro.cancelEmulatorInstall()
  }, [retroSetupBusy, retroSetupCanceling, t])

  const sourceCounts = useMemo(
    () => ({
      favorites: availableGames.filter((game) => favoriteIds.has(game.id)).length,
      all: games.length,
      steam: providerGames.filter((game) => game.provider === 'steam').length,
      epic: providerGames.filter((game) => game.provider === 'epic').length,
      gog: providerGames.filter((game) => game.provider === 'gog').length,
      xbox: providerGames.filter((game) => game.provider === 'xbox').length,
      playstation: providerGames.filter((game) => game.provider === 'playstation').length,
      ea: providerGames.filter((game) => game.provider === 'ea').length,
      ubisoft: providerGames.filter((game) => game.provider === 'ubisoft').length,
      retro: providerGames.filter((game) => game.provider === 'retro').length,
      local: providerGames.filter((game) => game.provider === 'local').length
    }),
    [availableGames, favoriteIds, games.length, providerGames]
  )

  const selectedGames = useMemo(() => {
    const collectionIds = new Set(activeCollection?.gameIds ?? [])
    return source === 'favorites'
      ? availableGames.filter((game) => favoriteIds.has(game.id))
      : activeCollection
        ? availableGames.filter((game) => collectionIds.has(game.id))
        : source === 'all'
          ? games
          : source === 'retro' && activeRetroSystem
            ? retroGames.filter((game) => game.retro?.systemId === activeRetroSystem)
            : providerGames.filter((game) => game.provider === source)
  }, [
    activeCollection,
    activeRetroSystem,
    availableGames,
    favoriteIds,
    games,
    providerGames,
    retroGames,
    source
  ])

  const categoryOptions = useMemo<LibrarySelectOption<string>[]>(() => {
    const labelsByValue = new Map<string, string>()
    for (const game of selectedGames) {
      for (const genre of game.metadata.genres ?? []) {
        const label = genre.trim()
        const value = normalizeLibraryCategory(label)
        if (value && !labelsByValue.has(value)) labelsByValue.set(value, label)
      }
    }
    const genres = [...labelsByValue.entries()]
      .sort((left, right) => titleCollator.compare(left[1], right[1]))
      .map(([value, label]) => ({ value, label }))
    return [{ value: ALL_LIBRARY_CATEGORIES, label: t('library.category.all') }, ...genres]
  }, [selectedGames, t, titleCollator])
  const activeCategory = categoryOptions.some((option) => option.value === category)
    ? category
    : ALL_LIBRARY_CATEGORIES

  useEffect(() => {
    if (category !== activeCategory) setCategory(activeCategory)
  }, [activeCategory, category, setCategory])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(language)
    return selectedGames
      .filter(
        (game) =>
          activeCategory === ALL_LIBRARY_CATEGORIES ||
          (game.metadata.genres ?? []).some(
            (genre) => normalizeLibraryCategory(genre) === activeCategory
          )
      )
      .filter(
        (game) =>
          !normalizedQuery || game.name.toLocaleLowerCase(language).includes(normalizedQuery)
      )
      .sort((left, right) => compareLibraryGames(left, right, sortOrder, titleCollator))
  }, [activeCategory, language, query, selectedGames, sortOrder, titleCollator])

  useEffect(() => {
    setCollectionIds(collections.map((collection) => collection.id))
  }, [collections, setCollectionIds])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    root.toggleAttribute('inert', showCollectionDialog || Boolean(collectionPendingDeletion))
    return () => root.removeAttribute('inert')
  }, [collectionPendingDeletion, containerRef, showCollectionDialog])

  useEffect(() => {
    if (source !== 'retro' && activeRetroSystem !== null) setActiveRetroSystem(null)
  }, [activeRetroSystem, source])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const strip = sourceStripRef.current
      const activeSource = Array.from(
        strip?.querySelectorAll<HTMLElement>('[data-library-source]') ?? []
      ).find((item) => item.dataset.librarySource === source)
      if (!strip || !activeSource) return

      const stripRect = strip.getBoundingClientRect()
      const activeRect = activeSource.getBoundingClientRect()
      const padding = 8
      if (activeRect.left < stripRect.left + padding) {
        strip.scrollBy({
          left: activeRect.left - stripRect.left - padding,
          behavior: reduceMotion ? 'auto' : 'smooth'
        })
      } else if (activeRect.right > stripRect.right - padding) {
        strip.scrollBy({
          left: activeRect.right - stripRect.right + padding,
          behavior: reduceMotion ? 'auto' : 'smooth'
        })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [reduceMotion, source])

  const returnToRetroSystems = useCallback((): void => {
    if (!activeRetroSystem) return
    restoreRetroSystemRef.current = activeRetroSystem
    setActiveRetroSystem(null)
    setQuery('')
  }, [activeRetroSystem])

  useBackHandler(
    returnToRetroSystems,
    isActive && source === 'retro' && activeRetroSystem !== null
  )

  const revealNextBatch = useCallback((): void => {
    if (revealLockedRef.current) return
    revealLockedRef.current = true
    setRenderLimit((current) => Math.min(filtered.length, current + RENDER_BATCH_SIZE))
    if (revealUnlockTimerRef.current) clearTimeout(revealUnlockTimerRef.current)
    revealUnlockTimerRef.current = setTimeout(() => {
      revealLockedRef.current = false
    }, 180)
  }, [filtered.length])

  useEffect(
    () => () => {
      if (revealUnlockTimerRef.current) clearTimeout(revealUnlockTimerRef.current)
    },
    []
  )

  // Reset only when the user changes the visible collection or its filters.
  // Metadata/artwork deltas must never remove the currently focused card from the DOM.
  useEffect(() => {
    setRenderLimit(Math.min(INITIAL_RENDER_LIMIT, filtered.length))
    // `filtered.length` is deliberately handled by the non-resetting effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, activeRetroSystem, query, sortOrder, source])

  useEffect(() => {
    setRenderLimit((current) => {
      if (filtered.length === 0) return 0
      return Math.min(filtered.length, Math.max(current, Math.min(INITIAL_RENDER_LIMIT, filtered.length)))
    })
  }, [filtered.length])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === searchRef.current) return
      const active = document.activeElement as HTMLElement | null
      const firstGame = containerRef.current?.querySelector<HTMLElement>('[data-game-card="true"]')
      const activeSource = containerRef.current?.querySelector<HTMLElement>(
        `[data-library-source="${source}"]`
      )

      if (source === 'retro' && activeRetroSystem === null) {
        const restoreSystemId = restoreRetroSystemRef.current
        const systemTile = restoreSystemId
          ? containerRef.current?.querySelector<HTMLElement>(
              `[data-retro-system="${restoreSystemId}"]`
            )
          : containerRef.current?.querySelector<HTMLElement>('[data-retro-system]')
        restoreRetroSystemRef.current = null
        focusElement(systemTile ?? activeSource ?? null)
        return
      }

      if (source === 'retro' && activeRetroSystem !== null) {
        const backButton = containerRef.current?.querySelector<HTMLElement>(
          '[data-retro-system-back]'
        )
        focusElement(firstGame ?? backButton ?? activeSource ?? null)
        return
      }

      if (active?.hasAttribute('data-library-source')) {
        focusElement(activeSource ?? null)
        return
      }
      focusElement(firstGame ?? activeSource ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeRetroSystem, containerRef, source])

  function sourceLabel(value: LibrarySource): string {
    if (value === 'favorites') return t('library.source.favorites')
    if (value === 'steam') return t('library.source.steam')
    if (value === 'epic') return t('library.source.epic')
    if (value === 'gog') return t('library.source.gog')
    if (value === 'xbox') return t('library.source.xbox')
    if (value === 'playstation') return t('library.source.playstation')
    if (value === 'ea') return t('library.source.ea')
    if (value === 'ubisoft') return t('library.source.ubisoft')
    if (value === 'retro') return t('library.source.retro')
    if (value === 'local') return t('library.source.local')
    return t('library.source.all')
  }

  return (
    <>
    <div
      ref={containerRef}
      onScroll={(event) => {
        const scroller = event.currentTarget
        const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        if (remaining < scroller.clientHeight * 1.25) revealNextBatch()
      }}
      className="scrollbar-none flex h-full flex-col gap-[clamp(1rem,3vh,1.75rem)] overflow-y-auto px-[clamp(1.5rem,3vw,3.5rem)] pb-[clamp(5rem,14vh,8rem)] pt-[calc(5rem+clamp(1.25rem,2.5vh,2.5rem))]"
      style={{ scrollPaddingBlock: 'clamp(1.5rem, 7vh, 4rem)' }}
    >
      <div
        onFocusCapture={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        className="grid grid-cols-1 gap-x-3 gap-y-2 2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] 2xl:items-center"
      >
        <div
          className="col-start-1 flex h-10 w-fit max-w-full shrink-0 items-center justify-self-center rounded-full border border-white/10 bg-black/25 px-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] 2xl:col-start-2 2xl:row-start-1"
          aria-label={t('library.source.label')}
        >
          <ControllerButtonHint
            button="leftTrigger"
            className="mx-1 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/20 px-1.5 text-[10px] font-black text-white/55"
          />
          <div
            ref={sourceStripRef}
            className="scrollbar-none flex h-full min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain px-0.5 py-1"
          >
            {LIBRARY_SOURCE_ORDER.map((value) => {
              const active = source === value
              const label = sourceLabel(value)
              const count = sourceCounts[value as keyof typeof sourceCounts] ?? 0
              return (
                <motion.button
                  layout
                  key={value}
                  data-focusable
                  data-library-source={value}
                  data-search-focus-fallback={active ? 'true' : undefined}
                  type="button"
                  aria-label={`${label}: ${count}`}
                  aria-pressed={active}
                  onClick={() => {
                    if (value === 'retro') setActiveRetroSystem(null)
                    setSource(value)
                  }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className={`group flex h-8 shrink-0 items-center overflow-hidden rounded-full px-1 transition-colors ${
                    active
                      ? 'bg-white/[0.11] pr-3 text-white'
                      : 'text-muted hover:bg-white/[0.07] hover:text-white'
                  }`}
                >
                  <LibrarySourceMark source={value} active={active} />
                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.span
                        key={`${value}-label`}
                        initial={{ width: 0, opacity: 0, x: -4 }}
                        animate={{ width: 'auto', opacity: 1, x: 0 }}
                        exit={{ width: 0, opacity: 0, x: -4 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="ml-2 max-w-[8rem] overflow-hidden truncate whitespace-nowrap text-xs font-bold"
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              )
            })}
            {collections.length > 0 && (
              <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-white/15" />
            )}
            {collections.map((collection) => {
              const value = collectionLibrarySource(collection.id)
              const active = source === value
              return (
                <motion.button
                  layout
                  key={collection.id}
                  data-focusable
                  data-library-source={value}
                  data-search-focus-fallback={active ? 'true' : undefined}
                  type="button"
                  aria-label={`${collection.name}: ${collection.gameIds.length}`}
                  aria-pressed={active}
                  onClick={() => setSource(value)}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex h-8 shrink-0 items-center overflow-hidden rounded-full px-1 transition-colors ${
                    active
                      ? 'bg-white/[0.11] pr-3 text-white'
                      : 'text-muted hover:bg-white/[0.07] hover:text-white'
                  }`}
                >
                  <LibrarySourceMark source={value} active={active} />
                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.span
                        key={`${value}-label`}
                        initial={{ width: 0, opacity: 0, x: -4 }}
                        animate={{ width: 'auto', opacity: 1, x: 0 }}
                        exit={{ width: 0, opacity: 0, x: -4 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="ml-2 max-w-[9rem] overflow-hidden truncate whitespace-nowrap text-xs font-bold"
                      >
                        {collection.name}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              )
            })}
            <button
              ref={collectionButtonRef}
              data-focusable
              type="button"
              onClick={() => setShowCollectionDialog(true)}
              aria-label={t('collections.manageTitle')}
              title={t('collections.manageTitle')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <FolderPlus size={16} />
            </button>
          </div>
          <ControllerButtonHint
            button="rightTrigger"
            className="mx-1 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/20 px-1.5 text-[10px] font-black text-white/55"
          />
        </div>
        <div className="col-start-1 flex min-w-0 items-center justify-center gap-2 2xl:col-start-3 2xl:row-start-1 2xl:justify-self-end">
          <motion.div
            layout
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={searchExpanded ? 'min-w-0 flex-1' : 'shrink-0'}
          >
            {searchExpanded ? (
              <div className="view-search-shell flex min-w-0 items-center gap-2 rounded-full border border-white/[0.06] bg-white/5 px-3 py-2.5">
                <Search size={16} className="shrink-0 text-muted" />
                <input
                  ref={searchRef}
                  data-focusable
                  data-view-search
                  data-library-search
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t('library.search')}
                  placeholder={t('library.search')}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                />
                <ControllerButtonHint
                  button="north"
                  className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1.5 text-[10px] font-black text-white/70"
                />
                <button
                  data-focusable
                  type="button"
                  onClick={collapseSearch}
                  aria-label={t('search.close')}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('library.search')}
                aria-keyshortcuts="Y"
                onClick={expandSearch}
                className="flex h-10 items-center gap-2 rounded-full border border-white/[0.06] bg-white/5 px-3 text-muted transition-colors hover:bg-white/10 hover:text-white"
              >
                <Search size={16} />
                <ControllerButtonHint
                  button="north"
                  className="flex h-6 min-w-6 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1.5 text-[10px] font-black text-white/70"
                />
              </button>
            )}
          </motion.div>
          {activeCollection && (
            <button
              ref={deleteCollectionButtonRef}
              data-focusable
              type="button"
              onClick={() => setCollectionPendingDeletion(activeCollection)}
              aria-label={t('library.collection.deleteAction', { name: activeCollection.name })}
              className="flex shrink-0 items-center gap-2 rounded-full border border-rose-200/15 bg-rose-300/[0.06] px-3.5 py-2.5 text-sm font-bold text-rose-100/75 transition-colors hover:bg-rose-300/10 hover:text-rose-100"
            >
              <Trash2 size={16} />
              <span className="hidden sm:inline">{t('library.collection.deleteShort')}</span>
            </button>
          )}
          <button
            data-focusable
            type="button"
            onClick={() => setShowRetroLibrary(true)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/15"
          >
            <Gamepad2 size={17} />
            <span className="hidden sm:inline">{t('retro.manageAction')}</span>
          </button>
          <button
            data-focusable
            type="button"
            onClick={() => setShowCustomWizard(true)}
            className="flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-bold text-black shadow-[0_10px_28px_rgb(var(--color-accent)/0.18)] transition-transform hover:scale-[1.02]"
          >
            <Plus size={17} strokeWidth={2.7} />
            <span className="hidden sm:inline">{t('customGame.addAction')}</span>
          </button>
        </div>
        {isLoadingMetadata && (
          <div className="col-span-full flex items-center justify-center gap-2 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t('library.loadingMetadata')}
          </div>
        )}
        {(source !== 'retro' || activeRetroSystem !== null) && (
          <div
            role="group"
            className="col-span-full flex flex-wrap items-center gap-3"
            aria-label={t('library.filters.label')}
          >
            <LibrarySelect
              label={t('library.sort.label')}
              value={sortOrder}
              options={sortOptions}
              onChange={setSortOrder}
              className="w-full sm:w-[clamp(13rem,21vw,19rem)]"
            />
            <LibrarySelect
              label={t('library.category.label')}
              value={activeCategory}
              options={categoryOptions}
              onChange={setCategory}
              className="w-full sm:w-[clamp(13rem,21vw,19rem)]"
            />
          </div>
        )}
      </div>

      {showSteamSyncNotice && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-amber-50"
        >
          <CircleAlert size={18} className="shrink-0 text-amber-300" />
          <div className="min-w-[14rem] flex-1">
            <p className="text-sm font-bold">{t('library.sync.title')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-50/70">{steamSyncMessage}</p>
          </div>
          <button
            data-focusable
            type="button"
            disabled={isRefreshing}
            onClick={() => void refreshLibrary()}
            className="flex shrink-0 items-center gap-2 rounded-full border border-amber-200/25 bg-amber-100/10 px-3 py-2 text-xs font-bold text-amber-50 transition-colors hover:bg-amber-100/15 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : undefined} />
            {t('library.sync.retry')}
          </button>
        </div>
      )}

      {source === 'retro' && activeRetroSystem === null ? (
        <RetroSystemHub
          games={retroGames}
          columns={retroSystemColumns}
          query={query}
          onSelect={(systemId) => {
            restoreRetroSystemRef.current = systemId
            setActiveRetroSystem(systemId)
            setQuery('')
          }}
        />
      ) : (
        <>
          {source === 'retro' && activeRetroSystem !== null && (
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl2 border border-white/[0.08] bg-white/[0.035] p-3">
                <button
                  data-focusable
                  data-retro-system-back
                  type="button"
                  onClick={returnToRetroSystems}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/25 text-white/70 transition-colors hover:border-accent/35 hover:text-accent"
                  aria-label={t('retro.systems.back')}
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="min-w-0 text-center">
                  <div className="flex min-w-0 items-center justify-center gap-1.5">
                    <RetroSystemMark systemId={activeRetroSystem} />
                    <h1 className="truncate text-xl font-black text-white">
                      {retroSystemById(activeRetroSystem).name}
                    </h1>
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-accent/80">
                    {t('retro.gamesCount', { count: activeRetroGames.length })}
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap justify-end gap-2">
                  <button
                    data-focusable
                    type="button"
                    disabled={retroFolderBusy}
                    data-disabled={retroFolderBusy ? 'true' : undefined}
                    onClick={() => void openActiveRetroFolder()}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3.5 py-2 text-xs font-bold text-white/65 transition-colors hover:border-accent/35 hover:text-accent disabled:opacity-45"
                  >
                    {retroFolderBusy ? (
                      <Loader2 size={15} className="shrink-0 animate-spin" />
                    ) : (
                      <FolderOpen size={15} className="shrink-0" />
                    )}
                    <span>
                      {retroFolderBusy ? t('retro.folder.preparing') : t('retro.folder.open')}
                    </span>
                  </button>
                  {retroSystemStatus && !hasReadyRetroEmulator && (
                    <button
                      data-focusable
                      type="button"
                      disabled={retroSetupCanceling}
                      data-disabled={retroSetupCanceling ? 'true' : undefined}
                      onClick={() =>
                        void (retroSetupBusy ? cancelActiveRetroSetup() : setupActiveRetroSystem())
                      }
                      className="flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-xs font-black text-black shadow-[0_8px_24px_rgb(var(--color-accent)/0.18)] disabled:opacity-45"
                    >
                      {retroSetupBusy ? (
                        retroSetupCanceling ? (
                          <Loader2 size={15} className="shrink-0 animate-spin" />
                        ) : (
                          <X size={15} className="shrink-0" />
                        )
                      ) : (
                        <Download size={15} className="shrink-0" />
                      )}
                      {retroSetupBusy
                        ? retroSetupCanceling
                          ? t('retro.setup.canceling')
                          : t('retro.setup.cancelInstallation')
                        : t('retro.setup.system')}
                    </button>
                  )}
                  <button
                    ref={retroEmulatorButtonRef}
                    data-focusable
                    type="button"
                    disabled={retroSetupBusy}
                    data-disabled={retroSetupBusy ? 'true' : undefined}
                    onClick={() => setShowRetroEmulator(true)}
                    className="flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3.5 py-2 text-xs font-bold text-white/65 transition-colors hover:border-accent/35 hover:text-accent disabled:opacity-45"
                    aria-label={t('retro.emulator.changeFor', {
                      system: retroSystemById(activeRetroSystem).name
                    })}
                  >
                    <Settings2 size={15} className="shrink-0" />
                    <span className="truncate">
                      {configuredRetroEmulatorName ?? t('retro.emulator.automatic')}
                    </span>
                    <span className="shrink-0 text-white/35">
                      · {t('retro.emulator.change')}
                    </span>
                  </button>
                </div>
              </div>
              {(retroSystemError || retroSystemNotice) && (
                <p
                  role={retroSystemError ? 'alert' : 'status'}
                  className={`rounded-xl border px-4 py-2.5 text-xs font-semibold ${
                    retroSystemError
                      ? 'border-rose-300/15 bg-rose-300/[0.08] text-rose-200'
                      : 'border-amber-200/15 bg-amber-100/[0.06] text-amber-50/75'
                  }`}
                >
                  {retroSystemError ?? retroSystemNotice}
                </p>
              )}
              </div>
          )}
          {filtered.length === 0 ? (
            <div className="flex min-h-[14rem] flex-col items-center justify-center rounded-xl2 border border-dashed border-white/10 bg-white/[0.025] px-6 text-center">
              <p className="text-sm font-semibold text-white/70">
                {games.length === 0 && loadedAt === 0
                  ? t('library.loading')
                  : query.trim() || activeCategory !== ALL_LIBRARY_CATEGORIES
                    ? t('library.filters.empty')
                    : source === 'favorites'
                      ? t('library.favorites.empty')
                      : activeCollection
                        ? t('library.collection.empty')
                        : source === 'local'
                          ? t('customGame.empty')
                          : source === 'retro' && activeRetroSystem
                            ? t('retro.systems.empty')
                            : source === 'retro'
                              ? t('retro.empty')
                              : !account &&
                                  !epicAccount &&
                                  !playStationAccount &&
                                  games.length === 0
                                ? t('library.noAccount')
                                : t('library.empty')}
              </p>
              {(query.trim() || activeCategory !== ALL_LIBRARY_CATEGORIES) && (
                <button
                  data-focusable
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setCategory(ALL_LIBRARY_CATEGORIES)
                  }}
                  className="mt-4 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {t('library.filters.reset')}
                </button>
              )}
              {source === 'local' && loadedAt > 0 && (
                <button
                  data-focusable
                  type="button"
                  onClick={() => setShowCustomWizard(true)}
                  className="mt-4 flex items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/15"
                >
                  <Plus size={16} />
                  {t('customGame.addAction')}
                </button>
              )}
              {source === 'retro' && loadedAt > 0 && (
                <button
                  data-focusable
                  type="button"
                  onClick={() => setShowRetroLibrary(true)}
                  className="mt-4 flex items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/15"
                >
                  <Gamepad2 size={16} />
                  {t('retro.addFolder')}
                </button>
              )}
            </div>
          ) : (
            <div
              data-navigation-grid
              data-grid-columns={gridColumns}
              onFocusCapture={(event) => {
                const focused = (event.target as HTMLElement).closest<HTMLElement>(
                  '[data-grid-index]'
                )
                const index = Number(focused?.dataset.gridIndex)
                if (Number.isInteger(index) && index >= renderLimit - preloadCardThreshold) {
                  revealNextBatch()
                }
              }}
              className="-mx-2 grid gap-[clamp(0.9rem,1.8vw,1.5rem)] px-2 pb-8 pt-2"
              style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
            >
              {filtered.slice(0, renderLimit).map((game, index) => (
                <GameCard key={game.id} game={game} navigationIndex={index} />
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {showCustomWizard && (
          <CustomGameWizard
            key="custom-game-wizard"
            onClose={() => setShowCustomWizard(false)}
            onCompleted={() => {
              setShowCustomWizard(false)
              setSource('local')
            }}
          />
        )}
        {showRetroLibrary && (
          <RetroLibraryDialog
            key="retro-library"
            onClose={() => setShowRetroLibrary(false)}
            onCompleted={() => {
              setActiveRetroSystem(null)
              setSource('retro')
            }}
          />
        )}
        {showRetroEmulator && activeRetroSystem && (
          <RetroSystemEmulatorDialog
            key={`retro-emulator-${activeRetroSystem}`}
            systemId={activeRetroSystem}
            systemName={retroSystemById(activeRetroSystem).name}
            onClose={() => setShowRetroEmulator(false)}
            onApplied={(emulatorName) => {
              setConfiguredRetroEmulatorName(emulatorName ?? null)
              void window.api.library.retro
                .getStatus()
                .then(setRetroSystemStatus)
                .catch(() => undefined)
              setShowRetroEmulator(false)
            }}
          />
        )}
      </AnimatePresence>
    </div>
    <AnimatePresence>
      {showCollectionDialog && (
        <LibraryCollectionDialog
          key="library-collections"
          onClose={() => {
            setShowCollectionDialog(false)
            requestAnimationFrame(() => focusElement(collectionButtonRef.current))
          }}
          onSelectCollection={(collectionId) => {
            setSource(collectionLibrarySource(collectionId))
            setShowCollectionDialog(false)
          }}
        />
      )}
    </AnimatePresence>
    <AnimatePresence>
      {collectionPendingDeletion && (
        <DeleteLibraryConfirmationDialog
          key={`delete-library-${collectionPendingDeletion.id}`}
          collection={collectionPendingDeletion}
          onCancel={() => {
            setCollectionPendingDeletion(null)
            requestAnimationFrame(() => focusElement(deleteCollectionButtonRef.current))
          }}
          onDeleted={() => {
            setCollectionPendingDeletion(null)
            setSource('all')
          }}
        />
      )}
    </AnimatePresence>
    </>
  )
}
