import { useMemo } from 'react'
import { Radio } from 'lucide-react'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useT } from '@renderer/i18n/useT'
import { useControllerButtonLabels } from '@renderer/state/controllerStore'

export function TickerBar(): JSX.Element {
  const account = useAuthStore((s) => s.account)
  const gameCount = useLibraryStore((s) => s.snapshot.games.length)
  const t = useT()
  const controllerLabels = useControllerButtonLabels()

  const messages = useMemo(() => {
    const list: string[] = []
    if (account) {
      list.push(t('ticker.connectedAs', { name: account.accountName }))
      if (gameCount > 0) list.push(t('ticker.gameCount', { count: gameCount }))
    } else {
      list.push(t('ticker.notConnected'))
    }
    list.push(
      t('ticker.controlsHint', {
        previous: controllerLabels.leftBumper,
        next: controllerLabels.rightBumper,
        confirm: controllerLabels.south,
        back: controllerLabels.east
      })
    )
    return list
  }, [account, controllerLabels, gameCount, t])

  const joined = messages.join('   ·   ')

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 overflow-hidden border-t border-white/5 bg-surface/60 px-4">
      <Radio size={13} className="shrink-0 text-accent" />
      <div className="flex-1 overflow-hidden">
        <div className="ticker-track flex w-max shrink-0 gap-8 whitespace-nowrap text-xs text-muted">
          <span>{joined}</span>
          <span aria-hidden="true">{joined}</span>
        </div>
      </div>
    </div>
  )
}
