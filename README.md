<p align="center">
  <img src="docs/images/orbit-handheld.webp" alt="ORBIT running on a gaming handheld" width="100%" />
</p>

<h1 align="center">ORBIT</h1>

<p align="center">
  A controller-first gaming launcher that brings your PC library together in one console-style home.
</p>

<p align="center">
  <a href="https://github.com/toonymak1993/orbit/releases/latest"><img alt="Download the latest release" src="https://img.shields.io/badge/download-latest%20release-22d3ee?style=for-the-badge&logo=windows11&logoColor=05070c" /></a>
  <img alt="Windows 11" src="https://img.shields.io/badge/Windows-11-111827?style=for-the-badge&logo=windows11&logoColor=white" />
  <img alt="Controller first" src="https://img.shields.io/badge/input-controller%20first-111827?style=for-the-badge" />
</p>

## One home for your games

ORBIT is an Electron-based Windows launcher designed for handhelds, TVs and desktop PCs. It combines a focused game library with a living home screen, store offers and upcoming releases — all built around controller and keyboard navigation.

- Steam, Epic Games, GOG, Xbox / Microsoft Store, PlayStation, EA app, Ubisoft Connect, retro systems and custom local games
- Console-style spatial navigation with visible focus and gamepad support
- Four Home layouts, including the Xbox-inspired XMODE, CoreSense recommendations and optional 3D card depth
- Friends Hub with Steam, Epic and optional Discord presence, conversations and notifications
- Favorites, custom collections and adjustable 4–8-column library layouts
- Live Steam, Epic Games and Xbox download/update activity
- Release calendar, wishlist offers and regional store prices
- Update badges for pending Steam game updates
- Session history, activity summaries and second-accurate local playtime
- Artwork Studio for covers, backgrounds and icons, plus profile avatars, local save backups, notifications and themes
- Safe per-game launch options and adaptive Xbox/PlayStation controller hints
- Quick Settings and a compact system HUD for battery, network and Bluetooth status
- Read-only Windows Update and graphics-driver checks
- Optional Xbox Mode and background Hardware Control

## A closer look

![ORBIT Home](docs/images/orbit-home.webp)

![ORBIT release calendar](docs/images/orbit-releases.webp)

## Download

ORBIT `0.1.2` is the current stable release. Download **`ORBIT-XboxMode-Setup-0.1.2-x64.exe`** from the [latest GitHub Release](https://github.com/toonymak1993/orbit/releases/latest). This is the only file required: the setup contains ORBIT, the signed Xbox Mode AppX, the public ORBIT certificate and the verified English installation flow.

Run the setup from the Windows account that should own ORBIT and approve the administrator prompt. After installation, Windows opens **Settings > Gaming > Xbox mode** so ORBIT can be selected as the home app.

> ORBIT `0.1.2` is signed with the publicly trusted Certum Open Source Code Signing certificate. ORBIT never installs this public certificate into a Windows trust store. During the one-time transition from old self-signed builds, setup keeps the legacy package and its development certificate in place because Windows scopes its data to the old package family. SmartScreen may still warn while a new certificate or binary builds reputation; always verify the SHA-256 and signer published in the release notes.

### Previous public beta

ORBIT `0.1.2-beta.2` remains available as the final historical prerelease on the [0.1.2 Beta 2 release page](https://github.com/toonymak1993/orbit/releases/tag/v0.1.2-beta.2). New users should install the stable all-in-one setup above.

Beta 2 adds the first publicly trusted ORBIT signing line, direct Xbox game installation requests, broader Xbox and Xbox 360 library reconciliation, richer Xbox download progress, Discord server access and more predictable hierarchical controller navigation. It also includes every Beta 1 feature. Beta 1 users must run this all-in-one setup manually once because the old build cannot trust a signer it did not yet know, then select **ORBIT Beta** under **Settings > Gaming > Xbox mode**. The legacy **ORBIT** package is intentionally retained to protect package-family-scoped data; do not remove it until you have confirmed your data in Beta 2. See the complete [0.1.2 Beta 2 testing notes](docs/releases/0.1.2-beta.2.md) before installing.

### Requirements

- Windows 11 x64
- A controller is recommended, but keyboard and mouse are supported
- Xbox Mode requires Windows 11 24H2 or newer

Xbox Mode visibility still depends on Microsoft's supported markets, device policy and phased Windows rollout. Keep Windows, the Xbox app and Game Bar current.

## What's new in 0.1.2

- Rolling Home and ORBIT Pulse add recent activity, friends and recommendations to the controller-first home screen
- Focus, pinned-game, library-slideshow and personal-wallpaper backgrounds now have independent motion controls
- Game logos, broader artwork search and cache clear/rebuild tools improve library presentation
- SteamGridDB, Steam Web API and RetroAchievements credentials stay encrypted behind Windows secure storage
- A supervised background controller service recovers more reliably and keeps its Windows login state consistent
- Update and uninstall hand-offs suspend and restore that service transactionally to avoid locked files or silent controller outages
- DualSense, XInput, media controls and spatial navigation are more resilient across launcher surfaces
- The complete English all-in-one Xbox Mode setup is signed with the official Certum certificate and handles a missing `GamingHomeApp` registry value

See the complete [0.1.2 release notes](docs/releases/0.1.2.md) for details.

## Build from source

```powershell
git clone https://github.com/toonymak1993/orbit.git
cd orbit
npm ci
npm run typecheck
npm run verify:steam
npm run verify:downloads
npm run verify:launch-arguments
npm run verify:updates
npm run dev
```

Create a production build with `npm run build`. Windows installer and Xbox Mode packaging details are documented in [PACKAGING.md](PACKAGING.md).

## Project status

ORBIT `0.1.2` is the current stable public release. The earlier `0.1.2-beta.2` build remains available only as historical test material. Integrations and packaging will continue to evolve as the launcher is tested across more PCs, handhelds and game libraries.

ORBIT is an independent project and is not affiliated with Valve, Epic Games, Microsoft, Xbox or the publishers shown in screenshots.

## License

Copyright (C) 2026 Luis Garcia.

ORBIT is free software licensed under the [GNU General Public License v3.0](LICENSE). You may use, study, modify and redistribute it under those terms. Distributed modified versions must preserve the license and make the corresponding source code available.

The optional Discord integration uses the separately licensed Discord Social SDK. See the [GPL linking exception](LICENSE_EXCEPTION.md) and [third-party notices](THIRD_PARTY_NOTICES.md); the Discord SDK itself is not covered by the GPL.
