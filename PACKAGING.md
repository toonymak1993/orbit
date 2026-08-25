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

The setup is version-independent across supported Xbox app releases. It treats Windows as the source of truth instead of maintaining a brittle Xbox app/build allow-list:

1. verifies the certificate lifetime and code-signing usage before trusting it;
2. verifies the AppX hash/signature plus its identity, publisher, architecture, full-trust entry point, Gaming Home extension/capability, registration metadata, SCCD, and packaged release contract before changing Windows;
3. accepts Windows 11 24H2 and newer instead of hard-coding individual cumulative-update or Xbox app versions;
4. reports missing Xbox/Game Bar packages and a policy-disabled Xbox Mode without making either a false compatibility requirement;
5. trusts only the bundled certificate in `LocalMachine\TrustedPeople` and re-validates the signature after trust is established;
6. enables Developer Mode for the community-beta SCCD capability;
7. refuses downgrades, treats an equal version as an idempotent verification, and installs or upgrades only for the interactive Windows account;
8. verifies the installed Gaming Home registration and required payload;
9. restores newly added certificate trust and the previous Developer Mode value when a first installation fails cleanly;
10. writes atomic success or failure diagnostics to `C:\ProgramData\ORBIT\Logs\xbox-mode-diagnostics.json`;
11. opens `Settings > Gaming > Xbox mode` so the user can select ORBIT.

The installer deliberately does not write `GamingHomeApp` directly. Windows Settings remains the owner of that selection, preventing a stale Gaming Home reference if a previous launcher is uninstalled.

Windows 11 version 24H2 (build `26100.0`) or newer is the package baseline. Actual Xbox Mode availability remains controlled by Microsoft through supported markets, device policy, and phased Windows feature rollout; installation success therefore does not claim that the feature is exposed on every eligible PC. Keep Windows, the Xbox app, and Game Bar current. The installer never applies display/device-form overrides or third-party preparation tools.

The current payload is x64. Windows 11 on Arm can run x64 app packages through emulation, so the installer accepts 64-bit Arm Windows as well; a native Arm64 ORBIT package is not built or hardware-validated yet.

For a side-effect-free preflight of a built package, run `Install-OrbitXboxMode.ps1 -PackagePath <appx> -CertificatePath <cer> -ValidateOnly`. The packaging gate runs the same preflight automatically.

## Version sources

- `package.json`: SemVer package version `0.1.0-beta.3`.
- `electron-builder.yml`: numeric Windows file version `0.1.0.2` and installer filename.
- `resources/release-manifest.json`: channel, display version, release sequence, numeric AppX identity version, minimum Xbox Mode Windows baseline, and shared packaging metadata.
- `build/xbox/AppxManifest.xml` and `build/xbox/Public/registration.json`: checked-in template values; the build stamps disposable staging copies from the release manifest and verification rejects drift.

Keep `appId: com.orbit.launcher`, AppX identity `ORBIT.GamingHome`, publisher `CN=ORBIT Development`, and application ID `ORBIT` stable across beta upgrades.
