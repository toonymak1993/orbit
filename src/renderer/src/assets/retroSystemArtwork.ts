import type { RetroSystemId } from '@shared/ipc'

import arcade from './retro-system-icons/arcade.png'
import atari2600 from './retro-system-icons/atari2600.png'
import atari7800 from './retro-system-icons/atari7800.png'
import atariLynx from './retro-system-icons/atarilynx.png'
import colecoVision from './retro-system-icons/colecovision.png'
import dreamcast from './retro-system-icons/dreamcast.png'
import famicomDiskSystem from './retro-system-icons/fds.png'
import gameBoy from './retro-system-icons/gb.png'
import gameBoyAdvance from './retro-system-icons/gba.png'
import gameBoyColor from './retro-system-icons/gbc.png'
import gameCube from './retro-system-icons/gamecube.png'
import gameGear from './retro-system-icons/gamegear.png'
import masterSystem from './retro-system-icons/mastersystem.png'
import megaDrive from './retro-system-icons/megadrive.png'
import nintendo64 from './retro-system-icons/n64.png'
import nintendoDs from './retro-system-icons/nds.png'
import nes from './retro-system-icons/nes.png'
import neoGeoPocket from './retro-system-icons/ngp.png'
import neoGeoPocketColor from './retro-system-icons/ngpc.png'
import pcEngine from './retro-system-icons/pce.png'
import playStation from './retro-system-icons/ps1.png'
import playStation2 from './retro-system-icons/ps2.png'
import psp from './retro-system-icons/psp.png'
import saturn from './retro-system-icons/saturn.png'
import sega32x from './retro-system-icons/sega32x.png'
import segaCd from './retro-system-icons/segacd.png'
import snes from './retro-system-icons/snes.png'
import virtualBoy from './retro-system-icons/virtualboy.png'
import wii from './retro-system-icons/wii.png'
import wiiU from './retro-system-icons/wiiu.png'
import wonderSwan from './retro-system-icons/wonderswan.png'
import wonderSwanColor from './retro-system-icons/wonderswancolor.png'

export const RETRO_SYSTEM_ARTWORK: Readonly<Record<RetroSystemId, string>> = {
  arcade,
  atari2600,
  atari7800,
  atarilynx: atariLynx,
  colecovision: colecoVision,
  dreamcast,
  fds: famicomDiskSystem,
  gamecube: gameCube,
  gamegear: gameGear,
  gb: gameBoy,
  gba: gameBoyAdvance,
  gbc: gameBoyColor,
  mastersystem: masterSystem,
  megadrive: megaDrive,
  n64: nintendo64,
  nds: nintendoDs,
  nes,
  ngp: neoGeoPocket,
  ngpc: neoGeoPocketColor,
  pce: pcEngine,
  ps1: playStation,
  ps2: playStation2,
  psp,
  saturn,
  sega32x,
  segacd: segaCd,
  snes,
  virtualboy: virtualBoy,
  wii,
  wiiu: wiiU,
  wonderswan: wonderSwan,
  wonderswancolor: wonderSwanColor
}
