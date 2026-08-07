import { playUiSound } from '@renderer/lib/uiAudio'

export function useLaunchGame(): (gameId: string) => void {
  return (gameId: string) => {
    void window.api.game.launch(gameId).catch(() => playUiSound('error'))
  }
}
