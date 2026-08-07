# ORBIT Windows packaging

ORBIT `0.0.0.3` ships in two signed Windows formats: a normal offline NSIS installer and a packaged Xbox Mode build. There is deliberately no automatic update client yet; a later package with the same identity and a higher version upgrades the existing installation while preserving local application data.

## Build the installer

Run:

```powershell
npm run build:win
```

The command generates the branded installer assets, creates or reuses a local development code-signing certificate, builds ORBIT, signs the application and installer, and verifies their signatures and Windows file versions. Output is written to `release`.

The private key and its DPAPI-protected password are kept in the ignored `.certificates` directory. Never distribute that directory.

## Install a development build on another test PC

Copy only these public files to the test PC:

- `ORBIT-Setup-0.0.0.3-x64.exe`
- `ORBIT-Development.cer`
- `Install-OrbitDevelopmentCertificate.ps1`

Trust the development publisher once, then run the installer. The script adds only this exact code-signing certificate to the local machine's TrustedPeople store and does not modify a Root certificate store:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-OrbitDevelopmentCertificate.ps1 -CertificatePath .\ORBIT-Development.cer
```

Self-signed certificates are for private development devices only. Before a public release, replace the generated certificate with an OV certificate or Azure Trusted Signing and provide it through `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` in the release pipeline.

## Version sources

- `package.json` contains the SemVer-compatible package version (`0.0.3`).
- `electron-builder.yml` contains the Windows `FileVersion` (`0.0.0.3`).
- `resources/release-manifest.json` is packaged with the app and is the version shown inside ORBIT.
- `release/distribution-manifest.json` and `release/SHA256SUMS.txt` are generated after a successful build.

Keep `appId: com.orbit.launcher` stable. NSIS derives a deterministic upgrade identity from it, allowing the next installer to replace the current version instead of creating a second ORBIT installation.

## Build the Xbox Mode package

Run:

```powershell
npm run build:xbox
```

This produces the self-contained `ORBIT-XboxMode-Setup-0.0.0.3-x64.exe`, the underlying signed AppX package, and an OmniConsole-style ZIP fallback with `Install-OrbitXboxMode.bat`. The package has the stable identity `ORBIT.GamingHome`, application ID `ORBIT`, the `windows.gamingApp` extension, and the `Microsoft.appCategory.gamingHome_8wekyb3d8bbwe` custom capability. `CustomCapability.SCCD` is placed at package root and authorizes the private development package. The build downloads Microsoft's pinned Windows SDK BuildTools package into the ignored `.tools` cache so current `MakeAppx` and `SignTool` versions are used reproducibly.

Install the one-click setup on a supported Windows 11 handheld by opening:

```powershell
.\ORBIT-XboxMode-Setup-0.0.0.3-x64.exe
```

The setup follows OmniConsole's development-package flow: it trusts the exact self-signed ORBIT certificate only in `LocalMachine\TrustedPeople`, enables Windows Developer Mode for the SCCD capability, installs the AppX package, and verifies the installed package identity. It does not add the certificate to a Root store. Then select ORBIT under **Settings > Gaming > Xbox mode > Choose home app**. The installer does not modify undocumented shell registry settings or silently make ORBIT the home app.

Keep `ORBIT.GamingHome`, publisher `CN=ORBIT Development`, and application ID `ORBIT` stable. Future Xbox Mode revisions must increase the four-part AppX identity version.
