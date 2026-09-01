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

ORBIT `0.1.1` is the current stable release. Download **`ORBIT-XboxMode-Setup-0.1.1-x64.exe`** from the [latest GitHub Release](https://github.com/toonymak1993/orbit/releases/latest). This is the only file required: the setup contains ORBIT, the signed Xbox Mode AppX, the public ORBIT certificate and the verified installation flow.

Run the setup from the Windows account that should own ORBIT and approve the administrator prompt. After installation, Windows opens **Settings > Gaming > Xbox mode** so ORBIT can be selected as the home app.

> The historical stable `0.1.1` release still uses the self-signed `CN=ORBIT Development` certificate. Public betas from `0.1.2-beta.2` onward use the publicly trusted Certum Open Source Code Signing certificate; ORBIT never installs that public certificate into a Windows trust store. During the one-time Beta 1 migration, setup may remove only the exact legacy ORBIT development certificate after the new package has been installed and verified. SmartScreen may still warn while a new certificate or binary builds reputation; always verify the SHA-256 and signer published in the release notes.

### Public beta

ORBIT `0.1.2-beta.2` is available for community testing as a GitHub prerelease. Beta testers should download only **`ORBIT-Beta-XboxMode-Setup-0.1.2-beta.2-x64.exe`** from the [0.1.2 Beta 2 release](https://github.com/toonymak1993/orbit/releases/tag/v0.1.2-beta.2). It is the complete English all-in-one setup and follows the beta update channel; stable installations remain on the stable channel.

Beta 2 adds the first publicly trusted ORBIT signing line, direct Xbox game installation requests, broader Xbox and Xbox 360 library reconciliation, richer Xbox download progress, Discord server access and more predictable hierarchical controller navigation. It also includes every Beta 1 feature. Beta 1 users must run this all-in-one setup manually once because the old build cannot trust a signer it did not yet know, then select ORBIT once again under **Settings > Gaming > Xbox mode**. See the complete [0.1.2 Beta 2 testing notes](docs/releases/0.1.2-beta.2.md) before installing.

### Requirements

- Windows 11 x64
- A controller is recommended, but keyboard and mouse are supported
- Xbox Mode requires Windows 11 24H2 or newer

Xbox Mode visibility still depends on Microsoft's supported markets, device policy and phased Windows rollout. Keep Windows, the Xbox app and Game Bar current.

## What's new in 0.1.1

- A new Friends Hub brings Steam, Epic and optional Discord friends, presence and activity into ORBIT
- Favorites, custom collections, denser library layouts and a richer Artwork Studio make larger libraries easier to organize
- Safer in-app updates verify the exact GitHub release asset, its SHA-256 digest and the pinned Authenticode signer before installation
- Steam, Epic and Xbox library synchronization now preserves valid games through partial provider failures and handles multi-store editions more accurately
- Xbox download progress now follows streaming, staging, installation and update phases without forcing a full library rescan
- Game launching now includes a three-second cancel window, stricter process detection and clearer provider-specific failures
- DualSense PS-button support, Quick Settings and the bottom status HUD improve handheld and controller use
- The all-in-one Xbox Mode setup is English-only and safely handles Windows systems where the optional `GamingHomeApp` registry value does not exist yet

See the complete [0.1.1 release notes](docs/releases/0.1.1.md) for details.

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

ORBIT `0.1.1` is the current stable public release, with `0.1.2-beta.2` available separately for community testing. Integrations and packaging will continue to evolve as the launcher is tested across more PCs, handhelds and game libraries.

ORBIT is an independent project and is not affiliated with Valve, Epic Games, Microsoft, Xbox or the publishers shown in screenshots.

## License

Copyright (C) 2026 Luis Garcia.

ORBIT is free software licensed under the [GNU General Public License v3.0](LICENSE). You may use, study, modify and redistribute it under those terms. Distributed modified versions must preserve the license and make the corresponding source code available.

The optional Discord integration uses the separately licensed Discord Social SDK. See the [GPL linking exception](LICENSE_EXCEPTION.md) and [third-party notices](THIRD_PARTY_NOTICES.md); the Discord SDK itself is not covered by the GPL.
