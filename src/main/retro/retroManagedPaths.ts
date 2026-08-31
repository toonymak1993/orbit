import { app } from 'electron'
import { join } from 'node:path'
import type { RetroSystemId } from '@shared/ipc'

export function managedEmulatorDirectory(emulatorId: string): string {
  return join(app.getPath('documents'), 'ORBIT', 'Emulators', emulatorId)
}

function legacyManagedEmulatorDirectory(emulatorId: string): string {
  return join(app.getPath('userData'), 'emulators', emulatorId)
}

export function managedEmulatorDirectories(emulatorId: string): string[] {
  return [managedEmulatorDirectory(emulatorId), legacyManagedEmulatorDirectory(emulatorId)]
}

export function managedRetroCoreDirectories(): string[] {
  return managedEmulatorDirectories('retroarch').map((directory) => join(directory, 'cores'))
}

export function managedRomRootDirectory(): string {
  return join(app.getPath('documents'), 'ORBIT', 'ROMs')
}

export function managedRomSystemDirectory(systemId: RetroSystemId): string {
  return join(managedRomRootDirectory(), systemId)
}
