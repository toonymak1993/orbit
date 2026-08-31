# Third-party notices

ORBIT is licensed under the GNU General Public License version 3 with the
additional permission described in [LICENSE_EXCEPTION.md](LICENSE_EXCEPTION.md).

## Discord Social SDK

ORBIT can optionally integrate the proprietary Discord Social SDK. The SDK and
its `discord_partner_sdk.dll` library are not part of ORBIT's GPL-licensed source
code and are not licensed under the GNU GPL. They remain subject to Discord's
separate Social SDK terms and notices:

- <https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms>
- <https://discord.com/developers/docs/social-sdk/index.html>

The official Windows installer may contain the SDK only as an integrated ORBIT
component. Do not extract or redistribute the SDK separately. The SDK's bundled
open-source dependency notices are installed with ORBIT and are also kept at
`resources/discord-social-sdk/License-Notices.txt`.

Source builders who are authorized by Discord to use the Social SDK must obtain
it directly from Discord and follow the setup instructions in
`resources/discord-social-sdk/README.md`.

## psn-api

ORBIT uses the MIT-licensed `psn-api` package to read a connected user's
PlayStation purchases and play history. `psn-api` is a community-maintained,
reverse-engineered client and is not affiliated with or endorsed by Sony or
PlayStation. Its license and source are available at:

- <https://github.com/achievements-app/psn-api>

## RetroArch Systematic system artwork

ORBIT includes selected system illustrations from the `systematic` XMB theme
in the Libretro RetroArch Assets repository. The files are licensed under the
Creative Commons Attribution 4.0 International license (CC BY 4.0) by their
respective Libretro / RetroArch Assets contributors. ORBIT renamed the selected
files to its internal system identifiers; the image pixels are unmodified.

- Source: <https://github.com/libretro/retroarch-assets/tree/73106363e14e34c08a5854b4cfbc29f184e3b783/xmb/systematic/png>
- License: <https://creativecommons.org/licenses/by/4.0/>

## 7zip-bin / 7-Zip

ORBIT uses the MIT-licensed `7zip-bin` package to validate and extract official
portable emulator archives. The bundled 7-Zip command-line binary remains
subject to the 7-Zip licensing terms (GNU LGPL with the documented unRAR
restriction).

- Package source: <https://github.com/develar/7zip-bin>
- 7-Zip license and source: <https://www.7-zip.org/license.txt>
