import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, FolderHeart, LibraryBig, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'
import type { GameCollection } from '@shared/ipc'

interface Props {
  gameId?: string
  onClose: () => void
  onSelectCollection?: (collectionId: string) => void
}

export function LibraryCollectionDialog({
  gameId,
  onClose,
  onSelectCollection
}: Props): JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const collections = useLibraryCollectionsStore((state) => state.collections)
  const createCollection = useLibraryCollectionsStore((state) => state.createCollection)
  const deleteCollection = useLibraryCollectionsStore((state) => state.deleteCollection)
  const toggleGameInCollection = useLibraryCollectionsStore(
    (state) => state.toggleGameInCollection
  )
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyCollectionId, setBusyCollectionId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<'duplicate' | 'failed' | null>(null)

  useBackHandler(onClose)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const firstChoice = rootRef.current?.querySelector<HTMLElement>('[data-collection-choice]')
      focusElement(firstChoice ?? inputRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!confirmDeleteId) return
    const timer = window.setTimeout(() => setConfirmDeleteId(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [confirmDeleteId])

  const handleCreate = async (): Promise<void> => {
    if (busy || !name.trim()) return
    setBusy(true)
    setFeedback(null)
    try {
      const collection = await createCollection(name, gameId)
      if (!collection) {
        setFeedback('duplicate')
        return
      }
      setName('')
      if (!gameId && onSelectCollection) onSelectCollection(collection.id)
    } catch {
      setFeedback('failed')
    } finally {
      setBusy(false)
    }
  }

  const handleToggle = async (collectionId: string): Promise<void> => {
    if (!gameId || busyCollectionId) return
    setBusyCollectionId(collectionId)
    setFeedback(null)
    try {
      await toggleGameInCollection(collectionId, gameId)
    } catch {
      setFeedback('failed')
    } finally {
      setBusyCollectionId(null)
    }
  }

  const handleDelete = async (collectionId: string): Promise<void> => {
    if (confirmDeleteId !== collectionId) {
      setConfirmDeleteId(collectionId)
      return
    }
    setBusyCollectionId(collectionId)
    setFeedback(null)
    try {
      await deleteCollection(collectionId)
      setConfirmDeleteId(null)
      requestAnimationFrame(() => {
        const firstChoice = rootRef.current?.querySelector<HTMLElement>('[data-collection-choice]')
        focusElement(firstChoice ?? inputRef.current)
      })
    } catch {
      setFeedback('failed')
    } finally {
      setBusyCollectionId(null)
    }
  }

  return (
    <motion.div
      ref={rootRef}
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={t(gameId ? 'collections.gameTitle' : 'collections.manageTitle')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-md"
    >
      <motion.section
        initial={{ y: 24, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 18, opacity: 0, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 330, damping: 29 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-surface shadow-[0_32px_100px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-4 border-b border-white/[0.07] px-6 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <FolderHeart size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white">
              {t(gameId ? 'collections.gameTitle' : 'collections.manageTitle')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t(gameId ? 'collections.gameBody' : 'collections.manageBody')}
            </p>
          </div>
          <button
            data-focusable
            type="button"
            onClick={onClose}
            aria-label={t('collections.close')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {collections.length === 0 ? (
            <div className="mb-5 rounded-2xl border border-dashed border-white/10 bg-white/[0.025] px-5 py-7 text-center">
              <LibraryBig size={24} className="mx-auto mb-3 text-white/25" />
              <p className="text-sm font-semibold text-white/70">{t('collections.empty')}</p>
              <p className="mt-1 text-xs text-muted">{t('collections.emptyBody')}</p>
            </div>
          ) : (
            <div className="mb-5 space-y-2">
              {collections.map((collection) => {
                const included = Boolean(gameId && collection.gameIds.includes(gameId))
                const collectionBusy = busyCollectionId === collection.id
                return (
                  <div
                    key={collection.id}
                    className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/20 p-2"
                  >
                    <button
                      data-focusable
                      data-collection-choice
                      type="button"
                      aria-pressed={gameId ? included : undefined}
                      disabled={collectionBusy}
                      onClick={() => {
                        if (gameId) void handleToggle(collection.id)
                        else onSelectCollection?.(collection.id)
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                        included ? 'bg-accent/12 text-white' : 'hover:bg-white/[0.06]'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                          included ? 'bg-accent text-black' : 'bg-white/[0.07] text-white/45'
                        }`}
                      >
                        {collectionBusy ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : included ? (
                          <Check size={16} strokeWidth={3} />
                        ) : (
                          <LibraryBig size={15} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white/85">
                          {collection.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted">
                          {t('collections.gameCount', { count: collection.gameIds.length })}
                        </span>
                      </span>
                    </button>
                    {!gameId && (
                      <button
                        data-focusable
                        type="button"
                        disabled={collectionBusy}
                        onClick={() => void handleDelete(collection.id)}
                        aria-label={t('collections.delete', { name: collection.name })}
                        className={`flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors ${
                          confirmDeleteId === collection.id
                            ? 'bg-rose-300/12 text-rose-200'
                            : 'text-white/35 hover:bg-white/[0.06] hover:text-rose-200'
                        }`}
                      >
                        <Trash2 size={15} />
                        {confirmDeleteId === collection.id && (
                          <span>{t('collections.confirmDelete')}</span>
                        )}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreate()
            }}
            className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4"
          >
            <label htmlFor="collection-name" className="text-xs font-semibold text-white/70">
              {t('collections.createTitle')}
            </label>
            <div className="mt-2 flex gap-2">
              <input
                ref={inputRef}
                id="collection-name"
                data-focusable
                type="text"
                maxLength={40}
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setFeedback(null)
                }}
                placeholder={t('collections.namePlaceholder')}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-accent/60"
              />
              <button
                data-focusable
                type="submit"
                disabled={busy || !name.trim()}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {t('collections.create')}
              </button>
            </div>
            <p aria-live="polite" className="mt-2 min-h-4 text-[11px] text-amber-200">
              {feedback === 'duplicate'
                ? t('collections.duplicate')
                : feedback === 'failed'
                  ? t('collections.failed')
                  : ''}
            </p>
          </form>
        </div>
      </motion.section>
    </motion.div>
  )
}

interface DeleteLibraryConfirmationDialogProps {
  collection: GameCollection
  onCancel: () => void
  onDeleted: () => void
}

export function DeleteLibraryConfirmationDialog({
  collection,
  onCancel,
  onDeleted
}: DeleteLibraryConfirmationDialogProps): JSX.Element {
  const t = useT()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const deleteCollection = useLibraryCollectionsStore((state) => state.deleteCollection)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useBackHandler(() => {
    if (!busy) onCancel()
  })

  useEffect(() => {
    const frame = requestAnimationFrame(() => focusElement(cancelButtonRef.current))
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleDelete = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await deleteCollection(collection.id)
      onDeleted()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <motion.div
      data-focus-scope="active"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-library-title"
      aria-describedby="delete-library-description"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (!busy && event.currentTarget === event.target) onCancel()
      }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-6 backdrop-blur-md"
    >
      <motion.section
        initial={{ y: 20, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 14, opacity: 0, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 330, damping: 29 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-[2rem] border border-rose-200/15 bg-surface shadow-[0_32px_100px_rgba(0,0,0,0.75)]"
      >
        <div className="px-6 pb-5 pt-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-300/10 text-rose-200">
            <Trash2 size={21} />
          </span>
          <h2 id="delete-library-title" className="mt-5 text-xl font-bold text-white">
            {t('collections.deleteTitle', { name: collection.name })}
          </h2>
          <p
            id="delete-library-description"
            className="mt-2 text-sm leading-relaxed text-muted"
          >
            {t('collections.deleteBody')}
          </p>
          <p aria-live="polite" className="mt-3 min-h-5 text-xs text-rose-200">
            {failed ? t('collections.deleteFailed') : ''}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/[0.07] px-6 py-5 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            data-focusable
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white/75 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
          >
            {t('collections.deleteCancel')}
          </button>
          <button
            data-focusable
            type="button"
            disabled={busy}
            onClick={() => void handleDelete()}
            className="flex items-center justify-center gap-2 rounded-xl bg-rose-300 px-4 py-3 text-sm font-bold text-rose-950 transition-transform hover:scale-[1.015] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {t('collections.deleteConfirm')}
          </button>
        </div>
      </motion.section>
    </motion.div>
  )
}
