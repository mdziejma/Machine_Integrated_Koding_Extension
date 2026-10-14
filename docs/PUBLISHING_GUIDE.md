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
3. Ensure your active namespace matches the `"publisher"` field in `package.json` (`mdzie`).

### Step 2: Generate an Access Token
1. In your Open VSX profile, go to **Access Tokens**.
2. Generate a new Personal Access Token (PAT) with publish permissions.
3. Save the token securely.

### Step 3: Publish via CLI
You can publish directly using the `ovsx` CLI tool:

```bash
# Using npx:
npx -y ovsx publish mike-koding-extension-1.6.0.vsix -p <YOUR_OPEN_VSX_PAT>

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

### Step 3: Publish via CLI
```bash
# Interactive or via environment variable:
npm run publish:vscode

# Or pass token via environment variable:
VSCE_PAT=<YOUR_AZURE_PAT> npm run publish:vscode
```

---

## 📦 4. Dual-Publishing Workflow (Open VSX + Microsoft Marketplace)

Releases can be packaged once and pushed to **both** registries simultaneously from your local terminal or via the **🚀 PUBLISH ALL** workspace action button:

1. Update `version` in `package.json`.
2. Run dual-publish:
   ```bash
   npm run publish:all
   ```
   *(If `OVSX_PAT` and `VSCE_PAT` are not set in your environment, the script will interactively prompt you for each token.)*
3. Or publish to individual registries:
   - **Package only:** `npm run package`
   - **Open VSX only:** `npm run publish:ovsx`
   - **Microsoft Marketplace only:** `npm run publish:vscode`

---

## 🧪 5. Local Offline / Manual Installation

Users who do not have marketplace access can install the `.vsix` manually:

```bash
code --install-extension mike-koding-extension-1.6.0.vsix --force
```
Or via VS Code UI: `Extensions (Cmd+Shift+X)` $\rightarrow$ `...` (top right) $\rightarrow$ `Install from VSIX...`.
