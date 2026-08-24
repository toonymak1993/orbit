# ORBIT Windows packaging

ORBIT `0.1.0-beta.3` ships as a signed community beta in two Windows formats: a normal offline NSIS installer and a packaged Xbox Mode / Full screen experience build. Automatic updates are not enabled yet. Stable application and package identities allow a later higher version to upgrade an existing installation while preserving local application data.

## Build the complete beta bundle

Run:

```powershell
npm run build:beta
```

The command performs TypeScript validation, builds ORBIT, creates both Windows installers, signs every executable and AppX, validates manifests and signatures, generates SHA-256 checksums, and writes the distributable ZIP to `release/ORBIT-Beta-0.1.0-beta.3-x64.zip`.

The ZIP contains only public distribution material. The private PFX and its DPAPI-protected password remain in the ignored `.certificates` directory and must never be distributed.

## Self-signed beta publisher

Until a commercial OV certificate or Azure Trusted Signing is available, the beta uses a dedicated self-signed code-signing certificate with subject `CN=ORBIT Development`. This follows the community-beta approach used by comparable Gaming Home projects, but Windows cannot establish public trust automatically.

Beta users must compare the certificate thumbprint against the value published by the ORBIT project before trusting `ORBIT-Development.cer`. The normal installer requires the included `Install-OrbitDevelopmentCertificate.ps1` first. The Xbox Mode setup imports the same exact certificate into `LocalMachine\TrustedPeople` as part of installation. Neither path adds it to a Root store.

Back up `.certificates` separately and securely. Losing the private key prevents future packages from preserving the same publisher identity. The password XML is protected by Windows DPAPI and may not decrypt for a different Windows user or PC.

## Normal Windows installer

Build only the standard installer with:

```powershell
npm run build:win
```

Output: `release/ORBIT-Beta-Setup-0.1.0-beta.3-x64.exe`.

## Xbox Mode / Full screen experience

Build only the Xbox package with:

```powershell
npm run build:xbox
```

Outputs include:

- `ORBIT-Beta-XboxMode-Setup-0.1.0-beta.3-x64.exe` — recommended self-contained setup.
- `ORBIT-Beta-XboxMode-0.1.0-beta.3-x64.appx` — signed Gaming Home package.
- `ORBIT-Beta-XboxMode-0.1.0-beta.3-x64.zip` — script-based fallback bundle.

The AppX keeps the stable identity `ORBIT.GamingHome`, application ID `ORBIT`, `windows.gamingApp` extension, and `Microsoft.appCategory.gamingHome_8wekyb3d8bbwe` custom capability. It targets both `Windows.Universal` and `Windows.Desktop`, matching working handheld Gaming Home packages.

The setup:

1. verifies that the AppX signer matches the bundled ORBIT certificate;
2. detects the real Windows build plus UBR revision;
3. reports whether native FSE support is available;
4. warns if Xbox or Game Bar is missing;
5. trusts only the bundled certificate in `LocalMachine\TrustedPeople`;
6. enables Developer Mode for the SCCD capability;
7. installs or upgrades the AppX and verifies its Gaming Home registration;
8. writes diagnostics to `C:\ProgramData\ORBIT\Logs\xbox-mode-diagnostics.json`;
9. opens `Settings > Gaming > Full screen experience` so the user can select ORBIT.

The installer deliberately does not write `GamingHomeApp` directly. Windows Settings remains the owner of that selection, preventing a stale Gaming Home reference if a previous launcher is uninstalled.

Windows 11 build `26100.7019` or newer is required. Builds `26100.8328+` and `26200.8328+` have native expanded FSE support and do not require a display-size override. Older or not-yet-enabled devices may need separate preparation with the current Xbox Full Screen Experience Tool.

## Version sources

- `package.json`: SemVer package version `0.1.0-beta.3`.
- `electron-builder.yml`: numeric Windows file version `0.1.0.2` and installer filename.
- `build/xbox/AppxManifest.xml`: numeric AppX identity version `0.1.0.2`.
- `resources/release-manifest.json`: channel, display version, release sequence, and shared packaging metadata.

Keep `appId: com.orbit.launcher`, AppX identity `ORBIT.GamingHome`, publisher `CN=ORBIT Development`, and application ID `ORBIT` stable across beta upgrades.
