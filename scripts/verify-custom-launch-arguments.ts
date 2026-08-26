import assert from 'node:assert/strict'
import {
  normalizeCustomLaunchArguments,
  parseCustomLaunchArguments
} from '../src/main/customLaunchArguments.ts'

assert.deepEqual(parseCustomLaunchArguments(), [])
assert.deepEqual(parseCustomLaunchArguments('   '), [])
assert.deepEqual(parseCustomLaunchArguments('--profile mods --fullscreen'), [
  '--profile',
  'mods',
  '--fullscreen'
])
assert.deepEqual(parseCustomLaunchArguments('--profile "My Mods"'), ['--profile', 'My Mods'])
assert.deepEqual(parseCustomLaunchArguments('"" --flag'), ['', '--flag'])
assert.deepEqual(parseCustomLaunchArguments('foo \\'), ['foo', '\\'])
assert.deepEqual(parseCustomLaunchArguments('\\\\'), ['\\\\'])
assert.deepEqual(parseCustomLaunchArguments('"C:\\Mods Folder\\\\"'), ['C:\\Mods Folder\\'])
assert.deepEqual(parseCustomLaunchArguments('"say \\"hello\\""'), ['say "hello"'])
assert.deepEqual(parseCustomLaunchArguments('--literal "& | > %"'), ['--literal', '& | > %'])
assert.deepEqual(parseCustomLaunchArguments('--name Übergröße'), ['--name', 'Übergröße'])

assert.equal(normalizeCustomLaunchArguments('  --profile "My Mods"  '), '--profile "My Mods"')
assert.equal(normalizeCustomLaunchArguments(''), undefined)
assert.throws(() => normalizeCustomLaunchArguments('"unfinished'))
assert.throws(() => normalizeCustomLaunchArguments('--value\u0000hidden'))
assert.throws(() => normalizeCustomLaunchArguments('--value\u0001hidden'))
assert.throws(() => normalizeCustomLaunchArguments('--first\n--second'))
assert.throws(() => normalizeCustomLaunchArguments('x'.repeat(4_097)))
assert.throws(() => parseCustomLaunchArguments(`"${'x'.repeat(2_049)}"`))
assert.throws(() => parseCustomLaunchArguments(Array.from({ length: 129 }, () => 'x').join(' ')))

console.log('Custom launch argument verification passed.')
