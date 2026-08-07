import type { AudioPreset } from '@shared/ipc'

export type UiSoundId =
  | 'navigate'
  | 'confirm'
  | 'back'
  | 'switch'
  | 'open'
  | 'close'
  | 'error'

interface Voice {
  start: number
  duration: number
  fromHz: number
  toHz: number
  level: number
  overtone?: number
  waveform?: 'sine' | 'triangle' | 'soft-square'
}

interface SoundRecipe {
  duration: number
  voices: Voice[]
  transient: number
  volume: number
  cooldownMs: number
  variants?: number
}

const ORBIT_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.042,
    voices: [
      { start: 0, duration: 0.042, fromHz: 470, toHz: 405, level: 0.34, overtone: 0.06 },
      { start: 0, duration: 0.032, fromHz: 145, toHz: 118, level: 0.2 }
    ],
    transient: 0.055,
    volume: 0.105,
    cooldownMs: 45,
    variants: 2
  },
  confirm: {
    duration: 0.125,
    voices: [
      { start: 0, duration: 0.1, fromHz: 245, toHz: 282, level: 0.38, overtone: 0.06 },
      { start: 0.022, duration: 0.103, fromHz: 465, toHz: 535, level: 0.25, overtone: 0.08 }
    ],
    transient: 0.04,
    volume: 0.135,
    cooldownMs: 70
  },
  back: {
    duration: 0.1,
    voices: [
      { start: 0, duration: 0.1, fromHz: 410, toHz: 265, level: 0.36, overtone: 0.06 },
      { start: 0.014, duration: 0.075, fromHz: 190, toHz: 145, level: 0.23 }
    ],
    transient: 0.03,
    volume: 0.115,
    cooldownMs: 70
  },
  switch: {
    duration: 0.078,
    voices: [
      { start: 0, duration: 0.078, fromHz: 255, toHz: 365, level: 0.34, overtone: 0.07 },
      { start: 0.014, duration: 0.058, fromHz: 510, toHz: 575, level: 0.14 }
    ],
    transient: 0.035,
    volume: 0.112,
    cooldownMs: 80,
    variants: 2
  },
  open: {
    duration: 0.145,
    voices: [
      { start: 0, duration: 0.12, fromHz: 215, toHz: 315, level: 0.34, overtone: 0.06 },
      { start: 0.03, duration: 0.115, fromHz: 430, toHz: 545, level: 0.24, overtone: 0.08 }
    ],
    transient: 0.025,
    volume: 0.125,
    cooldownMs: 100
  },
  close: {
    duration: 0.125,
    voices: [
      { start: 0, duration: 0.125, fromHz: 495, toHz: 275, level: 0.34, overtone: 0.06 },
      { start: 0.018, duration: 0.09, fromHz: 250, toHz: 165, level: 0.23 }
    ],
    transient: 0.02,
    volume: 0.112,
    cooldownMs: 100
  },
  error: {
    duration: 0.175,
    voices: [
      { start: 0, duration: 0.175, fromHz: 170, toHz: 138, level: 0.39, overtone: 0.04 },
      { start: 0.024, duration: 0.14, fromHz: 238, toHz: 198, level: 0.27 }
    ],
    transient: 0.025,
    volume: 0.13,
    cooldownMs: 180
  }
}

const GLASS_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.058,
    voices: [
      { start: 0, duration: 0.052, fromHz: 860, toHz: 735, level: 0.2, overtone: 0.18, waveform: 'triangle' },
      { start: 0.008, duration: 0.045, fromHz: 1280, toHz: 1120, level: 0.08, waveform: 'sine' }
    ],
    transient: 0.012,
    volume: 0.11,
    cooldownMs: 45,
    variants: 3
  },
  confirm: {
    duration: 0.19,
    voices: [
      { start: 0, duration: 0.14, fromHz: 520, toHz: 675, level: 0.2, overtone: 0.16, waveform: 'triangle' },
      { start: 0.035, duration: 0.145, fromHz: 790, toHz: 1040, level: 0.17, waveform: 'sine' },
      { start: 0.075, duration: 0.105, fromHz: 1180, toHz: 1390, level: 0.07, waveform: 'sine' }
    ],
    transient: 0.01,
    volume: 0.125,
    cooldownMs: 70
  },
  back: {
    duration: 0.145,
    voices: [
      { start: 0, duration: 0.145, fromHz: 960, toHz: 610, level: 0.19, overtone: 0.13, waveform: 'triangle' },
      { start: 0.02, duration: 0.105, fromHz: 610, toHz: 405, level: 0.12, waveform: 'sine' }
    ],
    transient: 0.009,
    volume: 0.11,
    cooldownMs: 70
  },
  switch: {
    duration: 0.115,
    voices: [
      { start: 0, duration: 0.1, fromHz: 650, toHz: 830, level: 0.19, overtone: 0.14, waveform: 'triangle' },
      { start: 0.025, duration: 0.085, fromHz: 1030, toHz: 1220, level: 0.09, waveform: 'sine' }
    ],
    transient: 0.01,
    volume: 0.112,
    cooldownMs: 80,
    variants: 3
  },
  open: {
    duration: 0.225,
    voices: [
      { start: 0, duration: 0.16, fromHz: 425, toHz: 570, level: 0.17, waveform: 'triangle' },
      { start: 0.045, duration: 0.16, fromHz: 710, toHz: 930, level: 0.17, overtone: 0.12, waveform: 'triangle' },
      { start: 0.095, duration: 0.12, fromHz: 1080, toHz: 1280, level: 0.07, waveform: 'sine' }
    ],
    transient: 0.008,
    volume: 0.12,
    cooldownMs: 100
  },
  close: {
    duration: 0.185,
    voices: [
      { start: 0, duration: 0.17, fromHz: 1080, toHz: 680, level: 0.15, waveform: 'triangle' },
      { start: 0.035, duration: 0.14, fromHz: 660, toHz: 405, level: 0.16, overtone: 0.1, waveform: 'triangle' }
    ],
    transient: 0.008,
    volume: 0.108,
    cooldownMs: 100
  },
  error: {
    duration: 0.19,
    voices: [
      { start: 0, duration: 0.19, fromHz: 285, toHz: 230, level: 0.27, waveform: 'triangle' },
      { start: 0.03, duration: 0.145, fromHz: 405, toHz: 325, level: 0.18, waveform: 'sine' }
    ],
    transient: 0.012,
    volume: 0.12,
    cooldownMs: 180
  }
}

const DEEP_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.052,
    voices: [
      { start: 0, duration: 0.05, fromHz: 145, toHz: 108, level: 0.42, overtone: 0.08, waveform: 'soft-square' },
      { start: 0, duration: 0.035, fromHz: 310, toHz: 245, level: 0.12, waveform: 'sine' }
    ],
    transient: 0.05,
    volume: 0.12,
    cooldownMs: 45,
    variants: 2
  },
  confirm: {
    duration: 0.17,
    voices: [
      { start: 0, duration: 0.135, fromHz: 112, toHz: 148, level: 0.45, overtone: 0.08, waveform: 'soft-square' },
      { start: 0.03, duration: 0.13, fromHz: 225, toHz: 292, level: 0.22, waveform: 'triangle' }
    ],
    transient: 0.06,
    volume: 0.14,
    cooldownMs: 70
  },
  back: {
    duration: 0.145,
    voices: [
      { start: 0, duration: 0.145, fromHz: 185, toHz: 92, level: 0.42, overtone: 0.07, waveform: 'soft-square' },
      { start: 0.018, duration: 0.095, fromHz: 330, toHz: 205, level: 0.13, waveform: 'triangle' }
    ],
    transient: 0.045,
    volume: 0.125,
    cooldownMs: 70
  },
  switch: {
    duration: 0.105,
    voices: [
      { start: 0, duration: 0.1, fromHz: 122, toHz: 192, level: 0.43, overtone: 0.07, waveform: 'soft-square' },
      { start: 0.02, duration: 0.075, fromHz: 280, toHz: 355, level: 0.13, waveform: 'triangle' }
    ],
    transient: 0.05,
    volume: 0.122,
    cooldownMs: 80,
    variants: 2
  },
  open: {
    duration: 0.2,
    voices: [
      { start: 0, duration: 0.17, fromHz: 96, toHz: 152, level: 0.44, overtone: 0.06, waveform: 'soft-square' },
      { start: 0.045, duration: 0.145, fromHz: 192, toHz: 305, level: 0.2, waveform: 'triangle' }
    ],
    transient: 0.045,
    volume: 0.135,
    cooldownMs: 100
  },
  close: {
    duration: 0.18,
    voices: [
      { start: 0, duration: 0.18, fromHz: 195, toHz: 94, level: 0.43, overtone: 0.07, waveform: 'soft-square' },
      { start: 0.025, duration: 0.125, fromHz: 340, toHz: 190, level: 0.15, waveform: 'triangle' }
    ],
    transient: 0.04,
    volume: 0.125,
    cooldownMs: 100
  },
  error: {
    duration: 0.22,
    voices: [
      { start: 0, duration: 0.22, fromHz: 88, toHz: 68, level: 0.46, overtone: 0.08, waveform: 'soft-square' },
      { start: 0.03, duration: 0.175, fromHz: 132, toHz: 108, level: 0.28, waveform: 'triangle' }
    ],
    transient: 0.04,
    volume: 0.14,
    cooldownMs: 180
  }
}

const MINIMAL_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.026,
    voices: [{ start: 0, duration: 0.024, fromHz: 720, toHz: 615, level: 0.17, waveform: 'soft-square' }],
    transient: 0.1,
    volume: 0.078,
    cooldownMs: 42,
    variants: 4
  },
  confirm: {
    duration: 0.07,
    voices: [{ start: 0, duration: 0.065, fromHz: 510, toHz: 615, level: 0.21, waveform: 'soft-square' }],
    transient: 0.085,
    volume: 0.09,
    cooldownMs: 65
  },
  back: {
    duration: 0.06,
    voices: [{ start: 0, duration: 0.058, fromHz: 590, toHz: 390, level: 0.2, waveform: 'soft-square' }],
    transient: 0.075,
    volume: 0.086,
    cooldownMs: 65
  },
  switch: {
    duration: 0.048,
    voices: [{ start: 0, duration: 0.045, fromHz: 620, toHz: 765, level: 0.18, waveform: 'soft-square' }],
    transient: 0.09,
    volume: 0.082,
    cooldownMs: 72,
    variants: 4
  },
  open: {
    duration: 0.09,
    voices: [
      { start: 0, duration: 0.05, fromHz: 455, toHz: 565, level: 0.18, waveform: 'soft-square' },
      { start: 0.035, duration: 0.05, fromHz: 660, toHz: 745, level: 0.1, waveform: 'sine' }
    ],
    transient: 0.07,
    volume: 0.086,
    cooldownMs: 90
  },
  close: {
    duration: 0.082,
    voices: [
      { start: 0, duration: 0.05, fromHz: 700, toHz: 560, level: 0.15, waveform: 'soft-square' },
      { start: 0.03, duration: 0.047, fromHz: 470, toHz: 380, level: 0.1, waveform: 'sine' }
    ],
    transient: 0.065,
    volume: 0.082,
    cooldownMs: 90
  },
  error: {
    duration: 0.105,
    voices: [{ start: 0, duration: 0.1, fromHz: 245, toHz: 205, level: 0.24, waveform: 'soft-square' }],
    transient: 0.06,
    volume: 0.095,
    cooldownMs: 160
  }
}

const STEAM_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.048,
    voices: [
      { start: 0, duration: 0.045, fromHz: 505, toHz: 450, level: 0.21, overtone: 0.08, waveform: 'triangle' },
      { start: 0.006, duration: 0.038, fromHz: 1010, toHz: 900, level: 0.055, waveform: 'sine' }
    ],
    transient: 0.025,
    volume: 0.096,
    cooldownMs: 44,
    variants: 3
  },
  confirm: {
    duration: 0.15,
    voices: [
      { start: 0, duration: 0.115, fromHz: 315, toHz: 385, level: 0.27, overtone: 0.07, waveform: 'triangle' },
      { start: 0.028, duration: 0.115, fromHz: 625, toHz: 755, level: 0.15, waveform: 'sine' }
    ],
    transient: 0.026,
    volume: 0.115,
    cooldownMs: 68
  },
  back: {
    duration: 0.125,
    voices: [
      { start: 0, duration: 0.12, fromHz: 690, toHz: 445, level: 0.2, waveform: 'triangle' },
      { start: 0.02, duration: 0.09, fromHz: 350, toHz: 250, level: 0.14, waveform: 'sine' }
    ],
    transient: 0.022,
    volume: 0.102,
    cooldownMs: 68
  },
  switch: {
    duration: 0.1,
    voices: [
      { start: 0, duration: 0.095, fromHz: 425, toHz: 585, level: 0.22, overtone: 0.07, waveform: 'triangle' },
      { start: 0.024, duration: 0.07, fromHz: 850, toHz: 975, level: 0.07, waveform: 'sine' }
    ],
    transient: 0.024,
    volume: 0.1,
    cooldownMs: 76,
    variants: 3
  },
  open: {
    duration: 0.185,
    voices: [
      { start: 0, duration: 0.145, fromHz: 260, toHz: 345, level: 0.24, waveform: 'triangle' },
      { start: 0.038, duration: 0.135, fromHz: 520, toHz: 675, level: 0.14, waveform: 'sine' },
      { start: 0.078, duration: 0.095, fromHz: 805, toHz: 925, level: 0.055, waveform: 'sine' }
    ],
    transient: 0.02,
    volume: 0.108,
    cooldownMs: 95
  },
  close: {
    duration: 0.16,
    voices: [
      { start: 0, duration: 0.15, fromHz: 800, toHz: 515, level: 0.14, waveform: 'triangle' },
      { start: 0.028, duration: 0.12, fromHz: 430, toHz: 265, level: 0.2, waveform: 'sine' }
    ],
    transient: 0.018,
    volume: 0.1,
    cooldownMs: 95
  },
  error: {
    duration: 0.185,
    voices: [
      { start: 0, duration: 0.18, fromHz: 195, toHz: 158, level: 0.31, waveform: 'soft-square' },
      { start: 0.025, duration: 0.145, fromHz: 285, toHz: 235, level: 0.17, waveform: 'triangle' }
    ],
    transient: 0.02,
    volume: 0.112,
    cooldownMs: 175
  }
}

const XBOX_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.05,
    voices: [
      { start: 0, duration: 0.047, fromHz: 185, toHz: 162, level: 0.34, waveform: 'soft-square' },
      { start: 0.004, duration: 0.042, fromHz: 615, toHz: 685, level: 0.1, waveform: 'triangle' }
    ],
    transient: 0.06,
    volume: 0.108,
    cooldownMs: 44,
    variants: 3
  },
  confirm: {
    duration: 0.18,
    voices: [
      { start: 0, duration: 0.145, fromHz: 150, toHz: 222, level: 0.36, overtone: 0.08, waveform: 'soft-square' },
      { start: 0.03, duration: 0.135, fromHz: 445, toHz: 675, level: 0.19, waveform: 'triangle' },
      { start: 0.075, duration: 0.095, fromHz: 860, toHz: 1010, level: 0.06, waveform: 'sine' }
    ],
    transient: 0.055,
    volume: 0.13,
    cooldownMs: 68
  },
  back: {
    duration: 0.15,
    voices: [
      { start: 0, duration: 0.15, fromHz: 270, toHz: 138, level: 0.35, waveform: 'soft-square' },
      { start: 0.022, duration: 0.11, fromHz: 690, toHz: 430, level: 0.13, waveform: 'triangle' }
    ],
    transient: 0.05,
    volume: 0.118,
    cooldownMs: 68
  },
  switch: {
    duration: 0.115,
    voices: [
      { start: 0, duration: 0.105, fromHz: 175, toHz: 265, level: 0.35, waveform: 'soft-square' },
      { start: 0.025, duration: 0.08, fromHz: 690, toHz: 890, level: 0.12, waveform: 'triangle' }
    ],
    transient: 0.055,
    volume: 0.116,
    cooldownMs: 76,
    variants: 3
  },
  open: {
    duration: 0.21,
    voices: [
      { start: 0, duration: 0.18, fromHz: 132, toHz: 208, level: 0.36, waveform: 'soft-square' },
      { start: 0.045, duration: 0.15, fromHz: 395, toHz: 620, level: 0.18, waveform: 'triangle' },
      { start: 0.09, duration: 0.105, fromHz: 790, toHz: 1030, level: 0.065, waveform: 'sine' }
    ],
    transient: 0.045,
    volume: 0.126,
    cooldownMs: 95
  },
  close: {
    duration: 0.185,
    voices: [
      { start: 0, duration: 0.18, fromHz: 300, toHz: 142, level: 0.35, waveform: 'soft-square' },
      { start: 0.035, duration: 0.135, fromHz: 760, toHz: 425, level: 0.15, waveform: 'triangle' }
    ],
    transient: 0.042,
    volume: 0.116,
    cooldownMs: 95
  },
  error: {
    duration: 0.23,
    voices: [
      { start: 0, duration: 0.225, fromHz: 108, toHz: 82, level: 0.43, waveform: 'soft-square' },
      { start: 0.035, duration: 0.18, fromHz: 168, toHz: 132, level: 0.25, waveform: 'triangle' }
    ],
    transient: 0.045,
    volume: 0.134,
    cooldownMs: 175
  }
}

const PLAYSTATION_RECIPES: Record<UiSoundId, SoundRecipe> = {
  navigate: {
    duration: 0.068,
    voices: [
      { start: 0, duration: 0.06, fromHz: 760, toHz: 875, level: 0.16, overtone: 0.17, waveform: 'triangle' },
      { start: 0.012, duration: 0.05, fromHz: 1390, toHz: 1260, level: 0.07, waveform: 'sine' }
    ],
    transient: 0.008,
    volume: 0.105,
    cooldownMs: 45,
    variants: 3
  },
  confirm: {
    duration: 0.235,
    voices: [
      { start: 0, duration: 0.17, fromHz: 440, toHz: 660, level: 0.17, waveform: 'triangle' },
      { start: 0.05, duration: 0.165, fromHz: 680, toHz: 990, level: 0.15, overtone: 0.13, waveform: 'triangle' },
      { start: 0.105, duration: 0.115, fromHz: 1280, toHz: 1530, level: 0.055, waveform: 'sine' }
    ],
    transient: 0.007,
    volume: 0.118,
    cooldownMs: 70
  },
  back: {
    duration: 0.19,
    voices: [
      { start: 0, duration: 0.185, fromHz: 1120, toHz: 710, level: 0.15, waveform: 'triangle' },
      { start: 0.04, duration: 0.13, fromHz: 650, toHz: 420, level: 0.13, waveform: 'sine' }
    ],
    transient: 0.007,
    volume: 0.105,
    cooldownMs: 70
  },
  switch: {
    duration: 0.15,
    voices: [
      { start: 0, duration: 0.135, fromHz: 585, toHz: 785, level: 0.16, waveform: 'triangle' },
      { start: 0.04, duration: 0.095, fromHz: 940, toHz: 1240, level: 0.08, waveform: 'sine' }
    ],
    transient: 0.008,
    volume: 0.108,
    cooldownMs: 80,
    variants: 3
  },
  open: {
    duration: 0.27,
    voices: [
      { start: 0, duration: 0.19, fromHz: 350, toHz: 515, level: 0.16, waveform: 'triangle' },
      { start: 0.06, duration: 0.185, fromHz: 615, toHz: 895, level: 0.15, waveform: 'triangle' },
      { start: 0.125, duration: 0.13, fromHz: 1080, toHz: 1460, level: 0.06, waveform: 'sine' }
    ],
    transient: 0.006,
    volume: 0.115,
    cooldownMs: 100
  },
  close: {
    duration: 0.235,
    voices: [
      { start: 0, duration: 0.22, fromHz: 1340, toHz: 850, level: 0.1, waveform: 'sine' },
      { start: 0.05, duration: 0.17, fromHz: 780, toHz: 455, level: 0.16, waveform: 'triangle' }
    ],
    transient: 0.006,
    volume: 0.105,
    cooldownMs: 100
  },
  error: {
    duration: 0.235,
    voices: [
      { start: 0, duration: 0.23, fromHz: 225, toHz: 182, level: 0.27, waveform: 'triangle' },
      { start: 0.04, duration: 0.175, fromHz: 340, toHz: 275, level: 0.17, waveform: 'sine' }
    ],
    transient: 0.009,
    volume: 0.116,
    cooldownMs: 180
  }
}

type AudibleAudioPreset = Exclude<AudioPreset, 'off'>

const SOUND_SETS: Record<AudibleAudioPreset, Record<UiSoundId, SoundRecipe>> = {
  orbit: ORBIT_RECIPES,
  soft: GLASS_RECIPES,
  deep: DEEP_RECIPES,
  minimal: MINIMAL_RECIPES,
  steam: STEAM_RECIPES,
  xbox: XBOX_RECIPES,
  playstation: PLAYSTATION_RECIPES
}

const buffers = new Map<string, AudioBuffer[]>()
const cursors = new Map<UiSoundId, number>()
const lastPlayedAt = new Map<UiSoundId, number>()
let audioContext: AudioContext | null = null
let audioOutput: AudioNode | null = null
let activePreset: AudioPreset = 'orbit'

function context(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 })
  }
  return audioContext
}

function output(audio: AudioContext): AudioNode {
  if (audioOutput) return audioOutput
  const compressor = audio.createDynamicsCompressor()
  compressor.threshold.value = -24
  compressor.knee.value = 16
  compressor.ratio.value = 3
  compressor.attack.value = 0.002
  compressor.release.value = 0.08
  compressor.connect(audio.destination)
  audioOutput = compressor
  return compressor
}

function voiceSample(voice: Voice, time: number): number {
  const localTime = time - voice.start
  if (localTime < 0 || localTime >= voice.duration) return 0
  const progress = localTime / voice.duration
  const attack = Math.min(1, localTime / 0.0035)
  const release = Math.pow(1 - progress, 2.65)
  const frequencyDelta = voice.toHz - voice.fromHz
  const phase =
    Math.PI * 2 *
    (voice.fromHz * localTime + (frequencyDelta * localTime * localTime) / (2 * voice.duration))
  const sine = Math.sin(phase)
  const fundamental =
    voice.waveform === 'triangle'
      ? (2 / Math.PI) * Math.asin(sine)
      : voice.waveform === 'soft-square'
        ? Math.tanh(sine * 1.85) / Math.tanh(1.85)
        : sine
  const overtone = Math.sin(phase * 2.006 + 0.28) * (voice.overtone ?? 0)
  return (fundamental + overtone) * voice.level * attack * release
}

function recipeFor(id: UiSoundId, preset: AudioPreset): SoundRecipe {
  return preset === 'off' ? ORBIT_RECIPES[id] : SOUND_SETS[preset][id]
}

function bufferKey(id: UiSoundId, preset: AudioPreset): string {
  return `${preset}:${id}`
}

function createSoundBuffer(id: UiSoundId, variant: number, preset: AudioPreset): AudioBuffer {
  const recipe = recipeFor(id, preset)
  const sampleRate = 48_000
  const frameCount = Math.ceil(recipe.duration * sampleRate)
  const output = context().createBuffer(1, frameCount, sampleRate)
  const channel = output.getChannelData(0)
  let seed = 0x6d2b79f5 ^ (variant * 0x9e3779b9) ^ id.charCodeAt(0)
  let previousNoise = 0

  for (let frame = 0; frame < frameCount; frame++) {
    const time = frame / sampleRate
    let sample = recipe.voices.reduce((sum, voice) => sum + voiceSample(voice, time), 0)

    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1
    const highPassedNoise = noise - previousNoise * 0.92
    previousNoise = noise
    const transientEnvelope = Math.exp(-time * 235)
    sample += highPassedNoise * recipe.transient * transientEnvelope

    const endFade = Math.min(1, (recipe.duration - time) / 0.006)
    channel[frame] = Math.tanh(sample * 1.28) * 0.72 * Math.max(0, endFade)
  }

  return output
}

/** Pre-renders ORBIT's short interaction tones once, with no files or decoding. */
export function preloadUiSounds(): void {
  if (activePreset === 'off') return
  const ids = Object.keys(ORBIT_RECIPES) as UiSoundId[]
  for (const id of ids) {
    const key = bufferKey(id, activePreset)
    if (buffers.has(key)) continue
    const variantCount = recipeFor(id, activePreset).variants ?? 1
    buffers.set(
      key,
      Array.from({ length: variantCount }, (_, variant) =>
        createSoundBuffer(id, variant, activePreset)
      )
    )
  }
}

export function setUiAudioPreset(preset: AudioPreset, preview = false): void {
  activePreset = preset
  if (!preview || preset === 'off') return
  lastPlayedAt.delete('confirm')
  playUiSound('confirm')
}

export function playUiSound(id: UiSoundId): void {
  if (activePreset === 'off') return
  const recipe = recipeFor(id, activePreset)
  const now = performance.now()
  if (now - (lastPlayedAt.get(id) ?? -Infinity) < recipe.cooldownMs) return
  lastPlayedAt.set(id, now)

  preloadUiSounds()
  const soundBuffers = buffers.get(bufferKey(id, activePreset))
  if (!soundBuffers?.length) return
  const nextCursor = cursors.get(id) ?? 0
  cursors.set(id, nextCursor + 1)

  const audio = context()
  if (audio.state === 'suspended') void audio.resume()
  const source = audio.createBufferSource()
  const filter = audio.createBiquadFilter()
  const gain = audio.createGain()
  source.buffer = soundBuffers[nextCursor % soundBuffers.length]
  filter.type = 'lowpass'
  filter.frequency.value =
    id === 'error'
      ? 1_250
      : activePreset === 'soft'
        ? 4_100
        : activePreset === 'deep'
          ? 1_150
          : activePreset === 'minimal'
            ? 3_200
            : 2_450
  filter.Q.value = 0.45
  gain.gain.value = recipe.volume
  source.connect(filter)
  filter.connect(gain)
  gain.connect(output(audio))
  source.start()
}

/** Mouse/touch clicks bypass the controller hook; synthetic A clicks have detail 0. */
export function installPointerUiSounds(): () => void {
  const warmUp = (): void => {
    preloadUiSounds()
    if (audioContext?.state === 'suspended') void audioContext.resume()
  }
  const handleClick = (event: MouseEvent): void => {
    warmUp()
    if (event.detail === 0) return
    const target = event.target as Element | null
    if (target?.closest('[data-focusable]:not([data-ui-sound-skip])')) playUiSound('confirm')
  }
  document.addEventListener('pointerdown', warmUp, { once: true })
  document.addEventListener('click', handleClick, true)
  return () => {
    document.removeEventListener('pointerdown', warmUp)
    document.removeEventListener('click', handleClick, true)
  }
}
