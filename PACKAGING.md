# ORBIT Windows packaging

ORBIT `0.1.0` is distributed as a signed x64 Windows release. The primary public artifact is the self-contained Xbox Mode setup:

`release/ORBIT-XboxMode-Setup-0.1.0-x64.exe`

This single executable embeds the complete signed AppX, the public ORBIT certificate and the hardened installation script. The private PFX and its DPAPI-protected password remain in the ignored `.certificates` directory and must never be distributed.

The release pipeline also creates a normal NSIS installer as a local verification and fallback artifact. It is not required as a second public download when the Xbox Mode setup is the selected distribution path.

## Stable release flow

Version metadata must move together across `package.json`, `package-lock.json`, `electron-builder.yml`, `resources/release-manifest.json` and `build/xbox/AppxManifest.xml`. Stable product versions use three-part SemVer (`X.Y.Z`); Windows and AppX identities use four numeric components.

For the first stable promotion:

- product and Git tag: `0.1.0` / `v0.1.0`;
- Windows and AppX identity: `0.1.0.4`;
- release sequence: `8`.

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
- the public `ORBIT-Development.cer` certificate;
- the validated Xbox Mode installer.

Before modifying Windows, setup validates certificate lifetime and usage, AppX hash/signature, identity, architecture, Gaming Home declarations, registration metadata, SCCD and the packaged release contract. It then imports only the bundled certificate into `LocalMachine\TrustedPeople`, enables Developer Mode for the SCCD capability, installs or upgrades the AppX for the interactive account, verifies registration and opens **Settings > Gaming > Xbox mode**.

The installer refuses downgrades, treats an equal package version as an idempotent verification, rolls back newly added trust and the previous Developer Mode value after a clean first-install failure, and writes diagnostics atomically to `C:\ProgramData\ORBIT\Logs\xbox-mode-diagnostics.json`.

It deliberately does not write `GamingHomeApp` directly. Windows Settings remains the owner of the selected home app.

## Platform requirements

- Windows 11 24H2 (build `10.0.26100.0`) or newer
- x64 Windows; 64-bit Arm Windows may use x64 emulation but is not hardware-validated
- current Xbox app and Game Bar recommended

Xbox Mode availability remains controlled by Microsoft through supported markets, device policy and phased feature rollout. Successful installation does not guarantee that the Xbox Mode setting is exposed on every otherwise eligible PC.

## Self-signed publisher

The current release uses the self-signed code-signing certificate `CN=ORBIT Development`. The EXE, AppX and their timestamps are cryptographically verifiable, but Windows cannot establish public trust before the certificate is installed. Users can therefore see an unknown-publisher or SmartScreen warning until ORBIT adopts a publicly trusted signing certificate or service.

Publish the release SHA-256 and certificate thumbprint in the GitHub release notes. The setup embeds only the public CER and never a private key. Neither the normal nor Xbox Mode path adds the certificate to a Root store.

Back up `.certificates` separately and securely. Losing the private key prevents future AppX versions from preserving the same publisher identity. The password XML is protected by Windows DPAPI and may not decrypt for a different Windows user or PC.

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

## Stable identities

Keep these values stable across upgrades:

- Electron app ID: `com.orbit.launcher`
- AppX identity: `ORBIT.GamingHome`
- publisher: `CN=ORBIT Development` while the current signing line is in use
- AppX application ID: `ORBIT`

Changing the AppX publisher or identity breaks the existing upgrade line and must be treated as a migration, not a routine release change.
