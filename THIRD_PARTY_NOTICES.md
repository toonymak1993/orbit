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
