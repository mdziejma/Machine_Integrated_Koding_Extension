# M.I.K.E. — Extension Publishing Guide (Open VSX & VS Code Marketplace)

This guide provides step-by-step instructions for publishing **M.I.K.E. (Machine-Integrated Koding Extension)** to the **Open VSX Registry** (used by VSCodium, Gitpod, Eclipse Theia, Cursor, and open-source VS Code distributions) as well as the **Visual Studio Marketplace**.

---

## 📦 1. Pre-Publishing Checklist

Before publishing a release:

1. **Verify Compilation & Tests:**
   ```bash
   npm run compile
   npm test
   ```
2. **Ensure Version Bump:**
   Update `"version": "x.y.z"` in `package.json`.
3. **Verify Documentation & Metadata:**
   - `package.json` contains valid `name`, `displayName`, `publisher`, `description`, `license`, `repository`, and `icon`.
   - `media/icon.png` is present (minimum 128x128 px).
   - `LICENSE` file is present.
   - `README.md` is complete.
4. **Build the `.vsix` Package:**
   ```bash
   npm run package
   ```
   This generates `mike-koding-extension-<version>.vsix`.

---

## 🌐 2. Publishing to Open VSX Registry (`open-vsx.org`)

The Open VSX Registry is the primary open-source extension registry.

### Step 1: Create an Account and Namespace
1. Go to [open-vsx.org](https://open-vsx.org/) and log in with your GitHub account.
2. In your user profile settings, navigate to **Namespaces**.
3. Create or claim a namespace that matches the `"publisher"` field in `package.json` (e.g. `mike-systems` or your personal GitHub username).

### Step 2: Generate an Access Token
1. In your Open VSX profile, go to **Access Tokens**.
2. Generate a new Personal Access Token (PAT) with publish permissions.
3. Save the token securely.

### Step 3: Publish via CLI
You can publish directly using the `ovsx` CLI tool:

```bash
# Using npm script:
npx -y ovsx publish mike-koding-extension-1.5.0.vsix -p <YOUR_OPEN_VSX_PAT>

# Or using the package.json script:
OVSX_PAT=<YOUR_OPEN_VSX_PAT> npm run publish:ovsx -- *.vsix -p $OVSX_PAT
```

Alternatively, you can manually upload the `.vsix` file through the [open-vsx.org](https://open-vsx.org/) web UI.

---

## 🛍️ 3. Publishing to Visual Studio Marketplace

### Step 1: Create a Visual Studio Marketplace Publisher
1. Visit the [Visual Studio Marketplace Management Portal](https://marketplace.visualstudio.com/manage).
2. Sign in with your Microsoft account.
3. Create a **Publisher ID** matching the `"publisher"` field in `package.json`.

### Step 2: Generate an Azure DevOps Personal Access Token (PAT)
1. Go to [Azure DevOps](https://dev.azure.com/).
2. Click **User Settings** (top right) $\rightarrow$ **Personal Access Tokens**.
3. Create a new token with:
   - **Organization:** `All accessible organizations`
   - **Scopes:** `Marketplace` $\rightarrow$ `Acquire`, `Manage`, `Publish`.

### Step 3: Publish via `@vscode/vsce` CLI
```bash
# Publish using vsce
npx -y @vscode/vsce publish --packagePath mike-koding-extension-1.5.0.vsix -p <YOUR_AZURE_PAT>

# Or via npm script:
npm run publish:vscode -- --packagePath *.vsix -p <YOUR_AZURE_PAT>
```

---

## 🤖 4. Automated Publishing with GitHub Actions

The repository includes an automated GitHub Actions workflow (`.github/workflows/release.yml`).

### Setup GitHub Secrets
In your new GitHub repository, navigate to **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions** and add:
- `OVSX_PAT`: Your Open VSX Personal Access Token.
- `VSCE_PAT`: Your Azure DevOps / VS Code Marketplace Personal Access Token.

### Triggering a Release
To publish a new version automatically:
1. Update `version` in `package.json`.
2. Commit and push your changes:
   ```bash
   git commit -am "Release v1.5.0"
   git tag v1.5.0
   git push origin main --tags
   ```
3. GitHub Actions will automatically:
   - Compile TypeScript in strict mode.
   - Run the automated unit test suite.
   - Package the `.vsix` bundle.
   - Create a GitHub Release with the attached `.vsix`.
   - Publish the extension to Open VSX and the VS Code Marketplace.

---

## 🧪 5. Local Offline / Manual Installation

Users who do not have marketplace access can install the `.vsix` manually:

```bash
code --install-extension mike-koding-extension-1.5.0.vsix --force
```
Or via VS Code UI: `Extensions (Cmd+Shift+X)` $\rightarrow$ `...` (top right) $\rightarrow$ `Install from VSIX...`.
