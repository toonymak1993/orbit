import { net } from 'electron'

export type MainProcessFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>

/**
 * Keep main-process HTTP traffic on Chromium's network stack. Electron's
 * bundled Node 24 / undici 7 can crash on a peer FIN while an unread response
 * body applies backpressure, whereas net.fetch is not backed by undici.
 */
export const fetchWithElectronNet: MainProcessFetch = (input, init) =>
  net.fetch(input.toString(), init)
