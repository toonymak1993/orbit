<p align="center">
  <img src="docs/images/orbit-handheld.webp" alt="ORBIT running on a gaming handheld" width="100%" />
</p>

<h1 align="center">ORBIT</h1>

<p align="center">
  A controller-first gaming launcher that brings your PC library together in one console-style home.
</p>

<p align="center">
  <a href="https://github.com/toonymak1993/orbit/releases"><img alt="Download the latest beta" src="https://img.shields.io/badge/download-latest%20beta-22d3ee?style=for-the-badge&logo=windows11&logoColor=05070c" /></a>
  <img alt="Windows 11" src="https://img.shields.io/badge/Windows-11-111827?style=for-the-badge&logo=windows11&logoColor=white" />
  <img alt="Controller first" src="https://img.shields.io/badge/input-controller%20first-111827?style=for-the-badge" />
</p>

## One home for your games

ORBIT is an Electron-based Windows launcher designed for handhelds, TVs and desktop PCs. It combines a focused game library with a living home screen, store offers and upcoming releases — all built around controller and keyboard navigation.

- Steam, Epic Games, Xbox / Microsoft Store and custom local games
- Console-style spatial navigation with visible focus and gamepad support
- Dynamic Home with recent games, playtime, deals and rich artwork
- Release calendar, wishlist offers and regional store prices
- Update badges for pending Steam game updates
- Custom artwork, local save backups, notifications and visual themes
- Optional Xbox Mode and background Hardware Control

## A closer look

![ORBIT Home](docs/images/orbit-home.webp)

![ORBIT release calendar](docs/images/orbit-releases.webp)

## Download

The first official ORBIT beta is available from [GitHub Releases](https://github.com/toonymak1993/orbit/releases). Download the Windows x64 installer, run it and follow the setup.

> ORBIT beta builds currently use a self-signed `ORBIT Development` certificate. Windows may therefore show an unknown-publisher warning until the project adopts a publicly trusted signing certificate.

### Requirements

- Windows 11 x64
- A controller is recommended, but keyboard and mouse are supported
- Xbox Mode requires Windows 11 24H2 or newer

## Build from source

```powershell
git clone https://github.com/toonymak1993/orbit.git
cd orbit
npm ci
npm run typecheck
npm run dev
```

Create a production build with `npm run build`. Windows installer and Xbox Mode packaging details are documented in [PACKAGING.md](PACKAGING.md).

## Project status

ORBIT is in beta. Features, integrations and packaging may still change while the launcher is tested across more PCs, handhelds and libraries.

ORBIT is an independent project and is not affiliated with Valve, Epic Games, Microsoft, Xbox or the publishers shown in screenshots.
