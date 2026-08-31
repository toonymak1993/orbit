import assert from 'node:assert/strict'
import {
  artworkIdentitySignature,
  automaticArtworkQuality,
  automaticArtworkScore,
  canonicalArtworkTitle,
  libretroArtworkFolderPriority,
  libretroArtworkFolders,
  matchLibretroThumbnail,
  shareArtworkIdentity
} from '../src/shared/artworkMatching.ts'
import {
  isPublicSteamArtworkUrl,
  parsePublicSteamSearchItems,
  publicSteamArtworkUrls
} from '../src/main/publicArtworkSearchPolicy.ts'

const pspFiles = [
  'God of War - Chains of Olympus (Europe) (En,Fr,De,Es,It,Ru).png',
  'God of War - Chains of Olympus (Japan).png',
  'God of War - Chains of Olympus (USA).png'
]

assert.equal(
  matchLibretroThumbnail(
    pspFiles,
    'God of War - Chains of Olympus',
    'God of War - Chains of Olympus (USA)',
    'de'
  ),
  'God of War - Chains of Olympus (USA).png'
)

assert.equal(
  matchLibretroThumbnail(pspFiles, 'God of War - Chains of Olympus', undefined, 'de'),
  'God of War - Chains of Olympus (Europe) (En,Fr,De,Es,It,Ru).png'
)

assert.equal(
  matchLibretroThumbnail(
    ['3rd Birthday, The (Europe).png', '3rd Birthday, The (USA).png'],
    'The 3rd Birthday',
    undefined,
    'en'
  ),
  '3rd Birthday, The (USA).png'
)

assert.equal(
  matchLibretroThumbnail(
    ["Assassin's Creed III (USA).png"],
    "Assassin's Creed II",
    undefined,
    'en'
  ),
  undefined
)

assert.equal(
  matchLibretroThumbnail(
    ['別のゲーム (Japan).png', 'ぼくのなつやすみ (Japan).png'],
    'ぼくのなつやすみ',
    undefined,
    'en'
  ),
  'ぼくのなつやすみ (Japan).png'
)

assert.deepEqual(
  libretroArtworkFolders('vertical'),
  ['Named_Boxarts'],
  'portrait library cards must never use a title screen or gameplay snap'
)
assert.deepEqual(libretroArtworkFolders('horizontal'), [
  'Named_Snaps',
  'Named_Titles',
  'Named_Boxarts'
])
assert.ok(
  libretroArtworkFolderPriority('horizontal', 'Named_Snaps') <
    libretroArtworkFolderPriority('horizontal', 'Named_Titles'),
  'a horizontal gameplay snap must replace an equal-sized cached title screen'
)
assert.equal(
  libretroArtworkFolderPriority('vertical', 'Named_Titles'),
  Number.POSITIVE_INFINITY,
  'title screens are not a portrait fallback tier'
)
assert.ok(
  automaticArtworkScore(320, 240, 'vertical') >
    automaticArtworkScore(512, 357, 'vertical'),
  'the Majora fixture documents why geometry alone cannot choose between semantic roles'
)

const n64RegionFiles = ['Super Mario 64 (Europe).png', 'Super Mario 64 (USA).png']
assert.equal(
  matchLibretroThumbnail(n64RegionFiles, 'Super Mario 64', 'Super Mario 64 (U) [!]', 'de'),
  'Super Mario 64 (USA).png',
  'GoodTools U must override the German locale preference'
)
assert.equal(
  matchLibretroThumbnail(n64RegionFiles, 'Super Mario 64', 'Super Mario 64 (E) [!]', 'en'),
  'Super Mario 64 (Europe).png',
  'GoodTools E must override the English locale preference'
)
assert.equal(
  matchLibretroThumbnail(
    ['Legend of Zelda, The - Ocarina of Time (USA).png'],
    'The Legend of Zelda - Ocarina of Time',
    undefined,
    'en'
  ),
  'Legend of Zelda, The - Ocarina of Time (USA).png'
)
assert.equal(
  matchLibretroThumbnail(
    ['Super Mario 64 (USA).png'],
    'Super Mario 64',
    'Super Mario 64 (Star Road)',
    'en'
  ),
  undefined,
  'an unknown parenthetical hack title must not collapse onto the retail game'
)
for (const files of [
  ['Super Mario 64 (USA).png', 'Super Mario 64 (Star Road) (USA).png'],
  ['Super Mario 64 (Star Road) (USA).png', 'Super Mario 64 (USA).png']
]) {
  assert.equal(
    matchLibretroThumbnail(files, 'Super Mario 64', 'Super Mario 64 (Star Road)', 'en'),
    'Super Mario 64 (Star Road) (USA).png',
    'hack artwork selection must not depend on index order'
  )
}
assert.equal(
  matchLibretroThumbnail(['Game (USA).png'], 'Game', 'Game (Revival)', 'en'),
  undefined,
  'ordinary words beginning with Rev must not be treated as revision metadata'
)
assert.equal(
  matchLibretroThumbnail(['Game (USA).png'], 'Game', 'Game (USA, Beta)', 'en'),
  undefined,
  'a mixed region/identity group must not be stripped as pure release metadata'
)
assert.equal(
  matchLibretroThumbnail(
    ['Super Mario 64 (USA).png', 'Super Mario 64 (USA + Star Road).png'],
    'Super Mario 64',
    'Super Mario 64 (USA + Star Road)',
    'en'
  ),
  'Super Mario 64 (USA + Star Road).png'
)
assert.equal(
  matchLibretroThumbnail(['Game (USA).png'], 'Game', 'Game (Unclosed Hack', 'en'),
  undefined,
  'an unclosed qualifier must fail conservatively instead of selecting retail artwork'
)
assert.equal(
  matchLibretroThumbnail(
    n64RegionFiles,
    'Super Mario 64',
    'Super Mario 64 (E) (M3) [!]',
    'en'
  ),
  'Super Mario 64 (Europe).png'
)
assert.equal(
  matchLibretroThumbnail(n64RegionFiles, 'Super Mario 64', 'Super Mario 64 (JUE) [!]', 'de'),
  'Super Mario 64 (Europe).png'
)
assert.equal(
  matchLibretroThumbnail(n64RegionFiles, 'Super Mario 64', 'Super Mario 64 (JUE) [!]', 'en'),
  'Super Mario 64 (USA).png'
)
assert.equal(
  matchLibretroThumbnail(
    ['Super Mario 64 (USA).png', 'Super Mario 64 (Japan).png'],
    'Super Mario 64',
    'Super Mario 64 (J) [!]',
    'en'
  ),
  'Super Mario 64 (Japan).png'
)
assert.equal(
  matchLibretroThumbnail(
    ['Super Mario 64 (Japan, USA).png'],
    'Super Mario 64',
    'Super Mario 64 (JUE) [!]',
    'de'
  ),
  'Super Mario 64 (Japan, USA).png'
)
assert.equal(
  matchLibretroThumbnail(
    ['LEGO Racers (Europe).png', 'LEGO Racers (USA).png'],
    'LEGO Racers',
    'LEGO Racers (E) (M10) (En,No,Da,Fi)',
    'en'
  ),
  'LEGO Racers (Europe).png'
)
assert.equal(
  matchLibretroThumbnail(
    ['Legend of Zelda, The: Ocarina of Time (USA).png'],
    'The Legend of Zelda: Ocarina of Time',
    undefined,
    'en'
  ),
  'Legend of Zelda, The: Ocarina of Time (USA).png'
)

assert.ok(
  automaticArtworkScore(512, 512, 'vertical') >
    automaticArtworkScore(3840, 2160, 'vertical'),
  'a square cover should beat a widescreen screenshot for a poster slot'
)

assert.ok(
  automaticArtworkScore(400, 600, 'vertical') >
    automaticArtworkScore(512, 512, 'vertical'),
  'a correctly proportioned poster should beat a square fallback'
)

assert.ok(
  automaticArtworkScore(1920, 1080, 'horizontal') >
    automaticArtworkScore(512, 512, 'horizontal'),
  'a widescreen image should beat a square fallback for a hero slot'
)

assert.equal(automaticArtworkQuality(512, 512, 'vertical'), 'low')
assert.equal(automaticArtworkQuality(600, 900, 'vertical'), 'high')
assert.equal(
  automaticArtworkQuality(1200, 1200, 'vertical'),
  'low',
  'a square icon must remain provisional for a 2:3 cover slot'
)
assert.equal(
  automaticArtworkQuality(3840, 2160, 'vertical'),
  'low',
  'extreme aspect mismatch must keep a 4K screenshot in the upgrade queue'
)
assert.equal(automaticArtworkQuality(999, 562, 'horizontal'), 'low')
assert.equal(
  automaticArtworkQuality(1920, 620, 'horizontal'),
  'high',
  'canonical Steam library hero key art must beat a larger gameplay screenshot'
)
assert.equal(automaticArtworkQuality(1920, 1080, 'horizontal'), 'high')

assert.equal(
  canonicalArtworkTitle("Assassin's Creed II"),
  canonicalArtworkTitle('Assassin’s Creed® 2™')
)
assert.equal(
  canonicalArtworkTitle('Anno 117 - Pax Romana'),
  canonicalArtworkTitle('Anno 117: Pax Romana')
)
assert.notEqual(
  canonicalArtworkTitle("Assassin's Creed II"),
  canonicalArtworkTitle("Assassin's Creed III")
)
assert.equal(canonicalArtworkTitle('Pokémon'), canonicalArtworkTitle('Pokemon'))

assert.equal(
  shareArtworkIdentity(
    {
      name: 'Prey',
      metadata: { releaseDateText: '4 May, 2017', developers: ['Arkane Studios'] }
    },
    {
      name: 'Prey',
      metadata: { releaseDateText: '2017-05-05', developers: ['Arkane Studios'] }
    }
  ),
  true
)
assert.equal(
  shareArtworkIdentity(
    {
      name: 'Prey',
      metadata: { releaseDateText: '4 May, 2017', developers: ['Arkane Studios'] }
    },
    {
      name: 'Prey',
      metadata: { releaseDateText: '11 July, 2006', developers: ['Human Head Studios'] }
    }
  ),
  false,
  'homonymous originals and reboots must not share artwork'
)
assert.equal(
  shareArtworkIdentity(
    { name: "Assassin's Creed Black Flag Resynced", metadata: {} },
    { name: "Assassin's Creed Black Flag Resynced", metadata: {} }
  ),
  false,
  'an equal display title alone is not sufficient cross-provider identity evidence'
)
assert.notEqual(
  artworkIdentitySignature({
    metadata: { releaseDateText: '4 May, 2017', developers: ['Arkane Studios'] }
  }),
  artworkIdentitySignature({
    metadata: { releaseDateText: '11 July, 2006', developers: ['Human Head Studios'] }
  }),
  'identity metadata changes must invalidate dependent artwork decisions'
)

assert.deepEqual(
  parsePublicSteamSearchItems({
    items: [
      { id: 33230, type: 'app', name: "Assassin's Creed 2" },
      { id: 33230, type: 'app', name: 'duplicate' },
      { id: 10, type: 'sub', name: 'not an app' },
      { id: -1, type: 'app', name: 'invalid' }
    ]
  }),
  [{ id: 33230, name: "Assassin's Creed 2" }]
)

const publicPoster = publicSteamArtworkUrls(33230, 'vertical')[0][0]
const publicHero = publicSteamArtworkUrls(33230, 'horizontal')[0][0]
assert.equal(isPublicSteamArtworkUrl(publicPoster), true)
assert.equal(isPublicSteamArtworkUrl(publicHero), true)
assert.match(publicHero, /library_hero\.jpg$/)
assert.ok(
  publicSteamArtworkUrls(33230, 'horizontal').flat().some((url) =>
    url.includes('/storepagebackground/app/33230')
  ),
  'the subdued store-page background should remain an explicit fallback'
)
assert.equal(
  isPublicSteamArtworkUrl(
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/33230/../../secret.jpg'
  ),
  false
)
assert.equal(
  isPublicSteamArtworkUrl('https://example.com/steam/apps/33230/library_600x900.jpg'),
  false
)

console.log('Artwork fallback matching verification passed.')
