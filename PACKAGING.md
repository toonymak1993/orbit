# ORBIT Windows packaging

ORBIT `0.1.1` is distributed as a signed x64 Windows release. The primary public artifact is the self-contained Xbox Mode setup:

`release/ORBIT-XboxMode-Setup-0.1.1-x64.exe`

This single executable embeds the complete signed AppX, the public ORBIT certificate and the hardened installation script. New releases beginning with `0.1.2-beta.2` use the non-exportable Certum SimplySign cloud key; the historical stable `0.1.1` release remains self-signed. No PFX, PIN, OTP or SimplySign token is stored in the repository, build output or release asset.

The release pipeline also creates a normal NSIS installer as a local verification and fallback artifact. It is not required as a second public download when the Xbox Mode setup is the selected distribution path.

Both interactive NSIS setup executables contain English as their only installer language, and the bundled Xbox Mode PowerShell installer pins its own output and diagnostics to `en-US`. Windows-owned interfaces—including UAC, SmartScreen and Settings—continue to follow the Windows display language.

Packaged ORBIT builds check the configured GitHub Releases channel automatically. The Xbox Mode build downloads only the exact `ORBIT-XboxMode-Setup-<version>-x64.exe` asset (or its Beta equivalent), verifies the SHA-256 digest reported by GitHub and the pinned Authenticode signer, and then invokes that same setup in a silent update-only mode. The NSIS fallback uses electron-builder update metadata from the same GitHub release. Source archives, branch contents and unversioned files are never update inputs.

The already published `0.1.0` build predates this updater and therefore cannot discover its successor by itself. Beta `0.1.2-beta.1` pins the previous self-signed signer and therefore cannot accept the first Certum-signed installer automatically. That one transition requires a manual download from GitHub. Releases built from the Certum signing line pin the new signer and can update normally afterward. Never replace a published asset under the same version tag—advance all version metadata before publishing.

## Stable release flow

Version metadata must move together across `package.json`, `package-lock.json`, `electron-builder.yml`, `resources/release-manifest.json` and `build/xbox/AppxManifest.xml`. Stable product versions use three-part SemVer (`X.Y.Z`); Windows and AppX identities use four numeric components.

For the `0.1.1` stable promotion:

- product and Git tag: `0.1.1` / `v0.1.1`;
- Windows and AppX identity: `0.1.1.0`;
- release sequence: `9`.

Build and verify the normal Windows installer first, then create the Xbox package from the same compiled source:

```powershell
npm run typecheck
npm run build
npm run build:win
npm run verify:win
npm run build:xbox
npm run verify:xbox
```

The Xbox builder derives Stable/Beta filenames, labels and distribution metadata from `resources/release-manifest.json`. It signs the AppX and setup with SHA-256 plus an RFC3161 timestamp and rejects missing timestamps during verification.

## Primary one-file installer

`ORBIT-XboxMode-Setup-<version>-x64.exe` contains:

- the complete ORBIT `Windows.FullTrustApplication` AppX;
- identity `ORBIT.GamingHome` and application ID `ORBIT`;
- the `windows.gamingApp` extension;
- the `Microsoft.appCategory.gamingHome_8wekyb3d8bbwe` custom capability and SCCD;
- the public `ORBIT-Code-Signing.cer` certificate;
- the validated Xbox Mode installer.

Before modifying Windows, setup validates certificate lifetime and usage, the public Certum trust chain, AppX hash/signature, identity, architecture, Gaming Home declarations, registration metadata, SCCD and the packaged release contract. It never installs the public Certum certificate into a Windows certificate store. It enables Developer Mode for the SCCD capability, installs the AppX for the interactive account, verifies registration and opens **Settings > Gaming > Xbox mode**.

The first Certum-signed AppX has a different Microsoft package family because an AppX publisher must exactly match the certificate subject. During the one-time migration, setup installs and validates the new package first. Only after that succeeds does it remove a legacy `CN=ORBIT Development` package with `-PreserveApplicationData`. If deployment or validation fails, the legacy package remains available. Windows owns the selected Gaming Home value, so the user must select the new ORBIT registration once in Settings.

The installer refuses downgrades, treats an equal package version as an idempotent verification, restores the previous Developer Mode value after a clean first-install failure, and writes diagnostics atomically to `C:\ProgramData\ORBIT\Logs\xbox-mode-diagnostics.json`.

For an existing Certum-signed Xbox Mode installation, ORBIT invokes the setup with `/ORBIT-UPDATE=1`. This hidden path requires an already installed package and already enabled Developer Mode; it never elevates or changes machine prerequisites or certificate trust. It force-closes the running AppX only for package deployment, launches the upgraded Gaming Home registration afterward, and writes per-user diagnostics to `%LOCALAPPDATA%\ORBIT\Logs\xbox-mode-update-diagnostics.json`. A failed update attempts to reopen the previous installed version.

It deliberately does not write `GamingHomeApp` directly. Windows Settings remains the owner of the selected home app.

## Platform requirements

- Windows 11 24H2 (build `10.0.26100.0`) or newer
- x64 Windows; 64-bit Arm Windows may use x64 emulation but is not hardware-validated
- current Xbox app and Game Bar recommended

Xbox Mode availability remains controlled by Microsoft through supported markets, device policy and phased feature rollout. Successful installation does not guarantee that the Xbox Mode setting is exposed on every otherwise eligible PC.

## Public code signing

New releases beginning with `0.1.2-beta.2` use the Certum Open Source Code Signing certificate with SHA-1 thumbprint `61E90C0AACBF2F407A575903FCC197F45B61706D`. The private RSA-3072 key remains non-exportable in SimplySign and is selected from `CurrentUser\My` by thumbprint. SignTool uses SHA-256 and the RFC3161 timestamp service `http://time.certum.pl`.

Publish the release SHA-256 and certificate thumbprint in the GitHub release notes. The setup embeds only the public CER and never a private key. Neither the normal nor Xbox Mode path installs a certificate into a Root or TrustedPeople store. After the replacement package is valid, the one-time Beta 1 migration may remove only the exact pinned legacy ORBIT development certificate from `LocalMachine\TrustedPeople`. A valid public signature removes the Unknown Publisher condition, but Microsoft SmartScreen can still warn while a new certificate or binary builds reputation.

Every GitHub release intended for automatic updates must use the matching `v<version>` tag, channel flag and exact asset filename. For the supported public Xbox Mode distribution, upload only `ORBIT-XboxMode-Setup-<version>-x64.exe`; never wildcard-upload stale files from `release/`. The GitHub asset API supplies the digest used by the Xbox updater, so this path does not require `latest.yml`.

Only if a future release publicly distributes the normal desktop fallback should that same release also upload its matching NSIS installer and `latest.yml`. Keep the signer thumbprint allowlist in `resources/release-manifest.json` aligned during future planned certificate rotation. A bridge must ship before the old signer is removed; an already published installer cannot learn a new signer retroactively.

Keep the Certum account, SimplySign recovery material and mobile device protected. Losing access to the cloud key prevents future AppX versions from preserving the same publisher identity. Development-only self-signed material may remain under ignored `.certificates`, but it is never accepted by the public release verifiers.

## Individual build targets

Normal NSIS installer:

```powershell
npm run build:win
```

Xbox Mode AppX, self-contained setup and fallback ZIP:

```powershell
npm run build:xbox
```

Side-effect-free AppX preflight:

```powershell
./scripts/windows/Install-OrbitXboxMode.ps1 -PackagePath <appx> -CertificatePath <cer> -ValidateOnly
```

The packaging gate runs the same preflight automatically.

Public builds must run in the interactive Windows account that owns the SimplySign certificate while SimplySign Desktop is connected. PIN dialogs may appear several times because Electron Builder signs the application, helpers, uninstallers and setup separately.

## Stable identities

Keep these values stable across upgrades:

- Electron app ID: `com.orbit.launcher`
- AppX identity: `ORBIT.GamingHome`
- publisher: `CN=Open Source Developer Luis Antonio Garcia Roque, O=Open Source Developer, L=Alfdorf, S=Baden-Württemberg, C=DE`
- AppX application ID: `ORBIT`

Changing the AppX publisher or identity breaks the existing upgrade line and must be treated as a migration, not a routine release change.
