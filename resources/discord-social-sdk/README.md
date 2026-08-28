# Discord Social SDK runtime

This directory is the packaging location for ORBIT's optional Discord Social SDK
integration. The proprietary SDK binary is intentionally excluded from the GPL
source repository.

Authorized source builders can obtain the current Windows x64 SDK from Discord,
then place the runtime at:

`resources/discord-social-sdk/win32-x64/discord_partner_sdk.dll`

Keep Discord's original `License-Notices.txt` in this directory. Use and
distribution remain subject to the Discord Social SDK Terms:

<https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms>

The ORBIT release verification scripts validate the expected SDK API and binary
hash before packaging.
