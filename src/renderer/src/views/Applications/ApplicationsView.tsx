import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AppWindow,
  CircleAlert,
  Gamepad2,
  Loader2,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Tv,
  X,
  Youtube,
  type LucideIcon
} from 'lucide-react'
import type {
  CustomApplicationDraft,
  OrbitApplication,
  OrbitApplicationCategory,
  OrbitApplicationSnapshot
} from '@shared/ipc'
import { DiscordMark } from '@renderer/components/DiscordMark'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { notify } from '@renderer/state/notificationStore'
import eaIcon from '@renderer/assets/library-icons/ea.png'
import epicIcon from '@renderer/assets/library-icons/epic.png'
import gogIcon from '@renderer/assets/library-icons/gog.png'
import playStationIcon from '@renderer/assets/library-icons/playstation.png'
import steamIcon from '@renderer/assets/library-icons/steam.png'
import ubisoftIcon from '@renderer/assets/library-icons/ubisoft.png'
import xboxIcon from '@renderer/assets/library-icons/xbox.png'

type ApplicationEditorState =
  | { mode: 'add'; draft: CustomApplicationDraft }
  | { mode: 'edit'; application: OrbitApplication }

const EMPTY_SNAPSHOT: OrbitApplicationSnapshot = {
  applications: [],
  scannedAt: 0,
  platform: 'windows'
}

const SECTION_TRANSLATIONS: Record<OrbitApplicationCategory, TranslationKey> = {
  media: 'applications.section.media',
  launcher: 'applications.section.launcher',
  standard: 'applications.section.standard',
  custom: 'applications.section.custom'
}

const APPLICATION_FALLBACK_ICONS: Record<string, string> = {
  'launcher:steam': steamIcon,
  'launcher:epic': epicIcon,
  'launcher:gog': gogIcon,
  'launcher:xbox': xboxIcon,
  'launcher:playstation': playStationIcon,
  'launcher:ea': eaIcon,
  'launcher:ubisoft': ubisoftIcon
}

export function ApplicationsView(): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const contentRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [editor, setEditor] = useState<ApplicationEditorState | null>(null)

  useEffect(() => {
    let active = true
    void window.api.applications
      .get()
      .then((next) => {
        if (!active) return
        setSnapshot(next)
        setLoadError(false)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    contentRef.current?.toggleAttribute('inert', Boolean(editor))
    return () => contentRef.current?.removeAttribute('inert')
  }, [editor])

  const grouped = useMemo(() => {
    const applications = snapshot.applications
    return {
      media: applications.filter((application) => application.category === 'media'),
      launcher: applications.filter((application) => application.category === 'launcher'),
      standard: applications.filter((application) => application.category === 'standard'),
      custom: applications.filter((application) => application.category === 'custom')
    }
  }, [snapshot.applications])

  async function refresh(): Promise<void> {
    if (refreshing) return
    setRefreshing(true)
    try {
      setSnapshot(await window.api.applications.refresh())
      setLoadError(false)
    } catch {
      setLoadError(true)
      notify({
        tone: 'error',
        titleKey: 'applications.notification.refreshFailedTitle',
        messageKey: 'applications.notification.refreshFailedBody'
      })
    } finally {
      setRefreshing(false)
    }
  }

  async function launch(application: OrbitApplication): Promise<void> {
    if (launchingId) return
    if (!application.available) {
      notify({
        tone: 'info',
        titleKey: 'applications.notification.unavailableTitle',
        messageKey: 'applications.notification.unavailableBody',
        vars: { app: application.name }
      })
      return
    }
    setLaunchingId(application.id)
    try {
      await window.api.applications.launch(application.id)
    } catch {
      notify({
        tone: 'error',
        titleKey: 'applications.notification.launchFailedTitle',
        messageKey: 'applications.notification.launchFailedBody',
        vars: { app: application.name }
      })
    } finally {
      setLaunchingId(null)
    }
  }

  async function selectCustomApplication(): Promise<void> {
    if (selecting) return
    setSelecting(true)
    try {
      const draft = await window.api.applications.custom.select()
      if (draft) setEditor({ mode: 'add', draft })
    } catch {
      notify({
        tone: 'error',
        titleKey: 'applications.notification.selectFailedTitle',
        messageKey: 'applications.notification.selectFailedBody'
      })
    } finally {
      setSelecting(false)
    }
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div aria-hidden="true" className="applications-ambient pointer-events-none absolute inset-0" />
      <div
        ref={contentRef}
        className="applications-view scrollbar-none h-full overflow-y-auto px-[clamp(1.25rem,3vw,3.5rem)] pb-[clamp(5rem,12vh,8rem)] pt-[calc(5rem+clamp(1.25rem,2.5vh,2.25rem))]"
        style={{ scrollPaddingBlock: 'clamp(1.5rem, 7vh, 4rem)' }}
      >
        <div className="mx-auto w-full max-w-[112rem]">
          <header className="applications-hero relative flex min-h-[clamp(4.5rem,10vh,7rem)] items-center justify-center px-16 text-center">
            <motion.div
              aria-hidden="true"
              initial={reduceMotion ? false : { opacity: 0, scaleX: 0.4 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="applications-title-line absolute left-1/2 top-1/2 h-px w-[min(32rem,52vw)] -translate-x-1/2 -translate-y-1/2"
            />
            <motion.h1
              initial={reduceMotion ? false : { opacity: 0, y: 14, letterSpacing: '0.06em' }}
              animate={{ opacity: 1, y: 0, letterSpacing: '-0.035em' }}
              transition={{ duration: reduceMotion ? 0.1 : 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="relative bg-base px-6 text-[clamp(1.75rem,3vw,2.7rem)] font-black text-white"
            >
              {t('applications.title')}
            </motion.h1>
            <button
              type="button"
              disabled={refreshing}
              data-disabled={refreshing ? 'true' : undefined}
              onClick={() => void refresh()}
              aria-label={refreshing ? t('applications.refreshing') : t('applications.refresh')}
              className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </header>

          {loading ? (
            <LoadingState />
          ) : loadError && snapshot.scannedAt === 0 ? (
            <ErrorState onRetry={() => void refresh()} />
          ) : (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="mt-[clamp(1rem,2vh,1.75rem)] space-y-[clamp(1.75rem,4vh,3rem)]"
            >
              <ApplicationSection
                category="media"
                applications={grouped.media}
                launchingId={launchingId}
                onLaunch={launch}
                entry
                sectionIndex={0}
              />
              <ApplicationSection
                category="launcher"
                applications={grouped.launcher}
                launchingId={launchingId}
                onLaunch={launch}
                sectionIndex={1}
              />
              <ApplicationSection
                category="standard"
                applications={grouped.standard}
                launchingId={launchingId}
                onLaunch={launch}
                sectionIndex={2}
              />
              <ApplicationSection
                category="custom"
                applications={grouped.custom}
                launchingId={launchingId}
                onLaunch={launch}
                onEdit={(application) => setEditor({ mode: 'edit', application })}
                sectionIndex={3}
                addTile={
                  <AddApplicationTile
                    busy={selecting}
                    onClick={() => void selectCustomApplication()}
                  />
                }
              />
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {editor && (
          <ApplicationEditor
            key={editor.mode === 'add' ? editor.draft.draftId : editor.application.id}
            state={editor}
            onSnapshot={setSnapshot}
            onClose={() => setEditor(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ApplicationSection({
  category,
  applications,
  launchingId,
  onLaunch,
  onEdit,
  addTile,
  entry = false,
  sectionIndex
}: {
  category: OrbitApplicationCategory
  applications: OrbitApplication[]
  launchingId: string | null
  onLaunch: (application: OrbitApplication) => void
  onEdit?: (application: OrbitApplication) => void
  addTile?: JSX.Element
  entry?: boolean
  sectionIndex: number
}): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const Icon =
    category === 'media'
      ? Tv
      : category === 'launcher'
        ? Gamepad2
        : category === 'standard'
          ? Sparkles
          : AppWindow
  const translation = SECTION_TRANSLATIONS[category]
  return (
    <motion.section
      aria-labelledby={`applications-${category}-title`}
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.38,
        delay: reduceMotion ? 0 : 0.08 + sectionIndex * 0.09,
        ease: [0.22, 1, 0.36, 1]
      }}
    >
      <div className="mb-3 flex items-center gap-2 px-1">
        <Icon size={17} className="text-accent" />
        <h2
          id={`applications-${category}-title`}
          className="text-[clamp(1.05rem,1.7vw,1.35rem)] font-black tracking-tight text-white"
        >
          {t(translation)}
        </h2>
      </div>
      <div className="applications-grid grid gap-[clamp(0.75rem,1.4vw,1.25rem)]">
        {applications.map((application, index) => (
          <ApplicationCard
            key={application.id}
            application={application}
            busy={launchingId === application.id}
            viewEntry={entry && index === 0}
            onLaunch={() => onLaunch(application)}
            onEdit={onEdit ? () => onEdit(application) : undefined}
            animationDelay={sectionIndex * 0.08 + index * 0.045}
          />
        ))}
        {addTile}
        {category === 'standard' && applications.length === 0 && <DiscordDiscoveryState />}
      </div>
    </motion.section>
  )
}

function ApplicationCard({
  application,
  busy,
  viewEntry,
  onLaunch,
  onEdit,
  animationDelay
}: {
  application: OrbitApplication
  busy: boolean
  viewEntry: boolean
  onLaunch: () => void
  onEdit?: () => void
  animationDelay: number
}): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const disabled = busy
  return (
    <motion.article
      data-application-card
      data-application-kind={application.id}
      data-application-available={application.available ? 'true' : 'false'}
      initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.42,
        delay: reduceMotion ? 0 : 0.16 + animationDelay,
        ease: [0.22, 1, 0.36, 1]
      }}
      whileHover={reduceMotion || disabled ? undefined : { y: -4, scale: 1.018 }}
      className="application-tile group relative flex aspect-[6/5] min-h-0 overflow-hidden rounded-[var(--radius-card)] border border-white/[0.09] bg-surface/60 shadow-card"
    >
      <div className="application-tile-glow pointer-events-none absolute inset-0" />
      <button
        data-focusable
        data-application-nav-item
        data-view-entry={viewEntry ? 'true' : undefined}
        type="button"
        disabled={disabled}
        data-disabled={disabled ? 'true' : undefined}
        aria-disabled={!application.available || busy}
        onClick={onLaunch}
        aria-label={t('applications.launch', { app: application.name })}
        className="relative flex min-w-0 flex-1 flex-col items-center justify-center p-[clamp(0.8rem,1.4vw,1.25rem)] text-center"
      >
        <ApplicationIcon application={application} />
        <span className="absolute inset-x-3 bottom-3 flex min-w-0 items-center justify-center gap-2">
          <span className="truncate text-[clamp(0.9rem,1.25vw,1.1rem)] font-black text-white">
            {application.name}
          </span>
          {busy && <Loader2 size={14} className="shrink-0 animate-spin text-accent" />}
        </span>
        {!application.available && (
          <CircleAlert
            aria-hidden="true"
            size={16}
            className="absolute left-3 top-3 text-rose-200/75"
          />
        )}
      </button>
      {onEdit && (
        <button
          data-application-edit-action
          type="button"
          tabIndex={-1}
          onClick={onEdit}
          aria-label={t('applications.edit', { app: application.name })}
          className="absolute right-2.5 top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.09] bg-black/35 text-white/45 opacity-75 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white"
        >
          <Pencil size={16} />
        </button>
      )}
    </motion.article>
  )
}

function ApplicationIcon({ application }: { application: OrbitApplication }): JSX.Element {
  if (application.id.includes('discord')) {
    return (
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-[#9aa2ff]/20 bg-[#5865f2] text-white shadow-[0_16px_34px_rgba(88,101,242,0.24)]">
        <DiscordMark size={44} className="h-[47%] w-[47%]" />
      </span>
    )
  }

  const iconSource = APPLICATION_FALLBACK_ICONS[application.id] ?? application.iconDataUrl
  if (iconSource) {
    return (
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.07] p-3 shadow-lg">
        <img src={iconSource} alt="" className="h-full w-full object-contain" />
      </span>
    )
  }
  if (application.id === 'builtin:amd-software') {
    return (
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-red-300/20 bg-gradient-to-br from-[#ed1c24] to-[#8d0810] text-white shadow-[0_16px_34px_rgba(237,28,36,0.22)]">
        <span className="text-[clamp(1rem,1.7vw,1.45rem)] font-black italic tracking-[-0.08em]">
          AMD
        </span>
      </span>
    )
  }
  if (application.id === 'builtin:nvidia-app') {
    return (
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-lime-200/20 bg-gradient-to-br from-[#8fda2d] to-[#4f8e13] text-[#081006] shadow-[0_16px_34px_rgba(118,185,0,0.22)]">
        <span className="text-[clamp(0.72rem,1.15vw,1rem)] font-black tracking-[-0.07em]">
          NVIDIA
        </span>
      </span>
    )
  }
  if (application.id === 'builtin:intel-graphics') {
    return (
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-sky-200/20 bg-gradient-to-br from-[#18a5e5] to-[#0058a8] text-white shadow-[0_16px_34px_rgba(0,113,197,0.22)]">
        <span className="text-[clamp(0.95rem,1.55vw,1.35rem)] font-black tracking-[-0.08em]">
          intel
        </span>
      </span>
    )
  }
  let Icon: LucideIcon = AppWindow
  let style = 'bg-accent/14 text-accent'
  if (application.id.includes('youtube')) {
    Icon = Youtube
    style = 'bg-red-500/18 text-red-300'
  } else if (application.id.includes('netflix')) {
    return (
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-red-300/15 bg-black/55 text-[clamp(2.1rem,3.5vw,3.2rem)] font-black text-red-500 shadow-lg">
        N
      </span>
    )
  } else if (application.id.includes('spotify')) {
    Icon = Music2
    style = 'bg-emerald-400/15 text-emerald-300'
  }
  return (
    <span
      className={`application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-white/10 shadow-lg ${style}`}
    >
      <Icon width="42%" height="42%" />
    </span>
  )
}

function AddApplicationTile({ busy, onClick }: { busy: boolean; onClick: () => void }): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  return (
    <motion.button
      data-focusable
      data-application-nav-item
      type="button"
      disabled={busy}
      data-disabled={busy ? 'true' : undefined}
      onClick={onClick}
      initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.42,
        delay: reduceMotion ? 0 : 0.34,
        ease: [0.22, 1, 0.36, 1]
      }}
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.018 }}
      className="application-add-tile group relative flex aspect-[6/5] min-h-0 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-white/15 bg-white/[0.025] p-4 text-center transition-colors hover:border-accent/50 hover:bg-accent/[0.055]"
    >
      <span className="application-icon flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-accent/20 bg-accent/10 text-accent">
        {busy ? <Loader2 size={30} className="animate-spin" /> : <Plus size={32} />}
      </span>
      <span className="absolute inset-x-3 bottom-3 truncate text-[clamp(0.9rem,1.25vw,1.1rem)] font-black text-white">
        {t('applications.add')}
      </span>
    </motion.button>
  )
}

function DiscordDiscoveryState(): JSX.Element {
  const t = useT()
  return (
    <div className="relative flex aspect-[6/5] min-h-0 flex-col items-center justify-center rounded-[var(--radius-card)] border border-white/[0.07] bg-white/[0.02] p-4 text-white/25">
      <span className="flex h-[clamp(4.25rem,6vw,5.75rem)] w-[clamp(4.25rem,6vw,5.75rem)] items-center justify-center rounded-[1.65rem] border border-[#7882ff]/10 bg-[#5865f2]/10 text-[#8d95ff]">
        <DiscordMark size={34} className="h-[42%] w-[42%]" />
      </span>
      <p className="absolute inset-x-3 bottom-3 truncate text-center text-sm font-bold text-white/35">
        {t('applications.discordNotFound')}
      </p>
    </div>
  )
}

function LoadingState(): JSX.Element {
  const t = useT()
  return (
    <div className="flex min-h-[45vh] items-center justify-center">
      <div className="text-center text-white/45">
        <Loader2 size={30} className="mx-auto animate-spin text-accent" />
        <p className="mt-3 text-sm font-semibold">{t('applications.loading')}</p>
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="flex min-h-[45vh] items-center justify-center">
      <div className="max-w-md text-center">
        <CircleAlert size={36} className="mx-auto text-rose-300" />
        <h2 className="mt-3 text-xl font-black">{t('applications.error')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('applications.errorBody')}</p>
        <button
          data-focusable
          data-view-entry="true"
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-black text-black"
        >
          {t('applications.retry')}
        </button>
      </div>
    </div>
  )
}

function ApplicationEditor({
  state,
  onSnapshot,
  onClose
}: {
  state: ApplicationEditorState
  onSnapshot: (snapshot: OrbitApplicationSnapshot) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [name, setName] = useState(
    state.mode === 'add' ? state.draft.suggestedName : state.application.name
  )
  const [launchArguments, setLaunchArguments] = useState(
    state.mode === 'edit' ? (state.application.launchArguments ?? '') : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const executablePath =
    state.mode === 'add' ? state.draft.executablePath : (state.application.executablePath ?? '')
  const iconData =
    state.mode === 'add' ? state.draft.iconDataUrl : state.application.iconDataUrl

  useBackHandler(() => {
    if (!busy) void close()
  })

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('[data-editor-entry="true"]')
      focusElement(first ?? null)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocusRef.current?.isConnected) focusElement(previousFocusRef.current)
    }
  }, [])

  async function close(): Promise<void> {
    if (state.mode === 'add') {
      await window.api.applications.custom.cancel(state.draft.draftId).catch(() => undefined)
    }
    onClose()
  }

  async function save(): Promise<void> {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const snapshot =
        state.mode === 'add'
          ? await window.api.applications.custom.commit({
              draftId: state.draft.draftId,
              name: name.trim(),
              launchArguments: launchArguments.trim() || undefined
            })
          : await window.api.applications.custom.update({
              applicationId: state.application.id,
              name: name.trim(),
              launchArguments: launchArguments.trim() || undefined
            })
      onSnapshot(snapshot)
      notify({
        tone: 'success',
        titleKey: 'applications.notification.savedTitle',
        messageKey: 'applications.notification.savedBody',
        vars: { app: name.trim() }
      })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('applications.editor.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (busy || state.mode !== 'edit') return
    setBusy(true)
    setError(null)
    try {
      onSnapshot(await window.api.applications.custom.remove(state.application.id))
      notify({
        tone: 'success',
        titleKey: 'applications.notification.removedTitle',
        messageKey: 'applications.notification.removedBody',
        vars: { app: state.application.name }
      })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('applications.editor.removeFailed'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      ref={dialogRef}
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-editor-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target && !busy) void close()
      }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-[clamp(1rem,4vw,4rem)] py-[clamp(1rem,5vh,3.5rem)] backdrop-blur-md"
    >
      <motion.section
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 18, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 320, damping: 31 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[clamp(1.4rem,2.4vw,2.4rem)] border border-white/10 bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.72)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(var(--color-accent)/0.14),transparent_38%)]" />
        <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.08] px-[clamp(1.25rem,3vw,2.5rem)] py-[clamp(1rem,2.5vh,1.75rem)]">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">
              ORBIT · APP
            </p>
            <h1
              id="application-editor-title"
              className="mt-1 text-[clamp(1.35rem,2.5vw,2.1rem)] font-black text-white"
            >
              {state.mode === 'add'
                ? t('applications.editor.addTitle')
                : t('applications.editor.editTitle')}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-white/50">
              {t('applications.editor.body')}
            </p>
          </div>
          <button
            data-focusable
            type="button"
            disabled={busy}
            data-disabled={busy ? 'true' : undefined}
            onClick={() => void close()}
            aria-label={t('applications.editor.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X size={19} />
          </button>
        </header>

        <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-[clamp(1rem,3vw,2.25rem)] overflow-y-auto p-[clamp(1.25rem,3vw,2.5rem)] md:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-3">
            <span className="flex aspect-square w-32 items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 bg-black/25 p-5 shadow-card">
              {iconData ? (
                <img src={iconData} alt="" className="h-full w-full object-contain" />
              ) : (
                <AppWindow size={48} className="text-accent" />
              )}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
              Windows EXE
            </span>
          </div>
          <div className="min-w-0 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-white/55">
                {t('applications.editor.name')}
              </span>
              <input
                data-focusable
                data-editor-entry="true"
                type="text"
                maxLength={120}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl2 border border-white/10 bg-black/25 px-4 py-3 text-base font-semibold text-white outline-none transition-colors focus:border-accent/60"
              />
            </label>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                {t('applications.editor.executable')}
              </p>
              <p className="mt-1 truncate text-xs font-medium text-white/65" title={executablePath}>
                {executablePath}
              </p>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-white/55">
                {t('applications.editor.arguments')}
              </span>
              <input
                data-focusable
                type="text"
                maxLength={4096}
                value={launchArguments}
                disabled={busy}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={t('applications.editor.argumentsPlaceholder')}
                onChange={(event) => setLaunchArguments(event.target.value)}
                className="w-full rounded-xl2 border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
              />
              <span className="mt-2 block text-xs leading-relaxed text-white/40">
                {t('applications.editor.argumentsHint')}
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {state.mode === 'edit' ? (
                <button
                  data-focusable
                  type="button"
                  disabled={busy}
                  data-disabled={busy ? 'true' : undefined}
                  onClick={() => void remove()}
                  className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold text-rose-200/70 transition-colors hover:bg-rose-300/10 hover:text-rose-100"
                >
                  <Trash2 size={16} />
                  {t('applications.editor.remove')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  data-focusable
                  type="button"
                  disabled={busy}
                  data-disabled={busy ? 'true' : undefined}
                  onClick={() => void close()}
                  className="rounded-full px-5 py-3 text-sm font-bold text-white/55 transition-colors hover:text-white"
                >
                  {t('applications.editor.cancel')}
                </button>
                <button
                  data-focusable
                  type="button"
                  disabled={busy || !name.trim()}
                  data-disabled={busy || !name.trim() ? 'true' : undefined}
                  onClick={() => void save()}
                  className="flex min-w-[9rem] items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-black text-black disabled:opacity-45"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Gamepad2 size={16} />}
                  {t('applications.editor.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="relative border-t border-rose-300/15 bg-rose-300/[0.08] px-6 py-3 text-sm text-rose-200"
          >
            {error}
          </p>
        )}
      </motion.section>
    </motion.div>,
    document.body
  )
}
