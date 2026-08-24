# ORBIT

ORBIT is an Electron-based gaming launcher with a console-oriented user interface.

## Restore the development environment

Install a current Node.js LTS release, clone this repository, and run:

```powershell
npm ci
npm run typecheck
npm run dev
```

Create a production renderer/main-process build with:

```powershell
npm run build
```

Windows installer and Xbox Mode packaging are documented in [PACKAGING.md](PACKAGING.md).

Create the complete signed community-beta bundle with:

```powershell
npm run build:beta
```

## Files intentionally not stored in GitHub

Generated dependencies and build outputs (`node_modules`, `out`, and `release`), downloaded build tools (`.tools`), local editor/assistant settings, and TypeScript build caches are excluded because they can be recreated.

The `.certificates` directory is also excluded because it contains the private development signing key and its password material. Keep it in a separate encrypted backup if existing signed development installations must remain upgradeable. The `orbit-development-password.xml` file is protected by Windows DPAPI and may not decrypt under a different Windows user or on a different PC; do not rely on the GitHub repository as a certificate backup.
