// evolve.js — self-improvement engine.
// Lets Alya edit her own code, add plugins, and read zip files.
// Owner-only. Sandboxed to the project directory. Safety-checked.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { exec } = require("node:child_process");

// The project root — all file ops are sandboxed under this.
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// Allowed file extensions for editing/creating
const ALLOWED_EXT = [".js", ".json", ".md", ".txt", ".env", ".gitignore", ".yml", ".yaml", ".sh"];

// Blocked patterns — never allow these in file writes or shell commands
const BLOCKED_PATTERNS = [
    /rm\s+-rf\s+\//,           // rm -rf /
    /:\(\)\s*\{.*\};/,         // fork bomb
    /mkfs/i,                    // format disk
    /dd\s+if=\/dev\//i,        // dd from device
    />\s*\/dev\/sd/i,          // write to disk device
    /curl.*\|\s*(ba)?sh/i,     // curl pipe to shell (remote exec)
    /wget.*\|\s*(ba)?sh/i,    // wget pipe to shell
];

function isBlocked(content) {
    return BLOCKED_PATTERNS.some(p => p.test(content));
}

function isPathSafe(targetPath) {
    const resolved = path.resolve(targetPath);
    // Must be inside project root
    const rel = path.relative(PROJECT_ROOT, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
    // Block sensitive paths
    if (/\.git\/|node_modules\/|state\/|database\/alya\.db/.test(rel)) return false;
    return true;
}

function isExtAllowed(targetPath) {
    const ext = path.extname(targetPath).toLowerCase();
    return ALLOWED_EXT.includes(ext) || ext === "";
}

class Evolve {
    constructor(bot) {
        this.bot = bot;
        this.pluginsDir = path.join(__dirname, "plugins");
        this.loadedPlugins = new Map(); // name -> module
        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
        }
    }

    // ---- READ: list project files ----
    listFiles(targetDir = null) {
        const dir = targetDir ? path.join(PROJECT_ROOT, targetDir) : PROJECT_ROOT;
        if (!isPathSafe(dir)) return { error: "Path di luar project directory." };
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            return entries.map(e => ({
                name: e.name,
                type: e.isDirectory() ? "dir" : "file",
                size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0
            })).filter(e => !e.name.startsWith(".git") && e.name !== "node_modules");
        } catch (e) {
            return { error: e.message };
        }
    }

    // ---- READ: get file content ----
    readFile(targetPath) {
        const full = path.join(PROJECT_ROOT, targetPath);
        if (!isPathSafe(full)) return { error: "Path di luar project directory." };
        if (!fs.existsSync(full)) return { error: "File tidak ada." };
        try {
            const content = fs.readFileSync(full, "utf8");
            const stat = fs.statSync(full);
            return { content, size: stat.size, path: targetPath };
        } catch (e) {
            return { error: e.message };
        }
    }

    // ---- WRITE: create or overwrite a file ----
    writeFile(targetPath, content) {
        const full = path.join(PROJECT_ROOT, targetPath);
        if (!isPathSafe(full)) return { error: "Path di luar project directory." };
        if (!isExtAllowed(full)) return { error: `Extension tidak diizinkan. Pakai: ${ALLOWED_EXT.join(", ")}` };
        if (isBlocked(content)) return { error: "Konten mengandung pola berbahaya yang diblokir." };
        try {
            const dir = path.dirname(full);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(full, content);
            // Syntax check for JS files
            if (full.endsWith(".js")) {
                const check = this._syntaxCheck(full);
                if (check.error) return { error: `File tersimpan tapi ada syntax error: ${check.error}`, saved: true };
            }
            return { success: true, path: targetPath, size: content.length };
        } catch (e) {
            return { error: e.message };
        }
    }

    // ---- PATCH: replace a string in a file ----
    patchFile(targetPath, oldStr, newStr) {
        const full = path.join(PROJECT_ROOT, targetPath);
        if (!isPathSafe(full)) return { error: "Path di luar project directory." };
        if (!fs.existsSync(full)) return { error: "File tidak ada." };
        if (isBlocked(newStr)) return { error: "Konten mengandung pola berbahaya." };
        try {
            const content = fs.readFileSync(full, "utf8");
            if (!content.includes(oldStr)) return { error: "String lama tidak ditemukan dalam file." };
            const patched = content.replace(oldStr, newStr);
            fs.writeFileSync(full, patched);
            if (full.endsWith(".js")) {
                const check = this._syntaxCheck(full);
                if (check.error) return { error: `Tersimpan tapi syntax error: ${check.error}`, saved: true };
            }
            return { success: true, path: targetPath };
        } catch (e) {
            return { error: e.message };
        }
    }

    // ---- DELETE: remove a file (not directories) ----
    deleteFile(targetPath) {
        const full = path.join(PROJECT_ROOT, targetPath);
        if (!isPathSafe(full)) return { error: "Path di luar project directory." };
        if (!fs.existsSync(full)) return { error: "File tidak ada." };
        if (fs.statSync(full).isDirectory()) return { error: "Tidak bisa hapus direktori." };
        try {
            fs.unlinkSync(full);
            return { success: true, path: targetPath };
        } catch (e) {
            return { error: e.message };
        }
    }

    // ---- SYNTAX CHECK ----
    _syntaxCheck(filePath) {
        return new Promise((resolve) => {
            execFile("node", ["--check", filePath], (err, stdout, stderr) => {
                if (err) resolve({ error: stderr.trim() || err.message });
                else resolve({ ok: true });
            });
        });
    }

    _syntaxCheckSync(filePath) {
        try {
            exec(`node --check ${JSON.stringify(filePath)}`, { timeout: 5000 });
            return { ok: true };
        } catch (e) {
            return { error: e.stderr || e.message };
        }
    }

    // ---- PLUGINS: load a plugin from plugins/ dir ----
    // Plugins export: { name, init(bot), onMessage?(msg, prompt) }
    loadPlugin(name) {
        const pluginPath = path.join(this.pluginsDir, `${name}.js`);
        if (!fs.existsSync(pluginPath)) return { error: `Plugin ${name}.js tidak ada.` };
        try {
            // Clear from require cache if reloading
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);
            if (typeof plugin.init === "function") {
                plugin.init(this.bot);
            }
            this.loadedPlugins.set(name, plugin);
            console.log(`[TG-evolve] plugin loaded: ${name}`);
            return { success: true, name };
        } catch (e) {
            return { error: e.message };
        }
    }

    unloadPlugin(name) {
        if (!this.loadedPlugins.has(name)) return { error: `Plugin ${name} tidak loaded.` };
        const plugin = this.loadedPlugins.get(name);
        if (typeof plugin.destroy === "function") {
            try { plugin.destroy(); } catch {}
        }
        this.loadedPlugins.delete(name);
        const pluginPath = path.join(this.pluginsDir, `${name}.js`);
        delete require.cache[require.resolve(pluginPath)];
        console.log(`[TG-evolve] plugin unloaded: ${name}`);
        return { success: true, name };
    }

    listPlugins() {
        // List files in plugins dir
        let files = [];
        try {
            files = fs.readdirSync(this.pluginsDir)
                .filter(f => f.endsWith(".js"))
                .map(f => f.replace(/\.js$/, ""));
        } catch {}
        const loaded = [...this.loadedPlugins.keys()];
        return { available: files, loaded };
    }

    // Call all loaded plugins' onMessage hooks
    onMessage(msg, prompt) {
        let handled = false;
        for (const [name, plugin] of this.loadedPlugins) {
            if (typeof plugin.onMessage === "function") {
                try {
                    const result = plugin.onMessage(msg, prompt, this.bot);
                    if (result) handled = true;
                } catch (e) {
                    console.error(`[TG-evolve] plugin ${name} onMessage error:`, e.message);
                }
            }
        }
        return handled;
    }

    // ---- ZIP: read contents of a zip file using Python3 ----
    // Telegram sends files via getFile + download. We get the buffer,
    // save it to a temp file, then use Python3 zipfile to list/extract.
    async readZip(zipBuffer, { extract = false, targetDir = null } = {}) {
        const os = require("node:os");
        const tmpZip = path.join(os.tmpdir(), `alya_zip_${Date.now()}.zip`);
        const extractDir = targetDir
            ? path.join(PROJECT_ROOT, targetDir)
            : path.join(os.tmpdir(), `alya_zip_extract_${Date.now()}`);

        try {
            fs.writeFileSync(tmpZip, zipBuffer);

            // Use Python3 to list and optionally extract
            const pyScript = extract ? this._pyExtractScript() : this._pyListScript();
            const result = await new Promise((resolve) => {
                const proc = execFile("python3", ["-c", pyScript, tmpZip, extractDir], {
                    timeout: 30000,
                    maxBuffer: 1024 * 1024 * 5
                }, (err, stdout, stderr) => {
                    resolve({ err, stdout, stderr });
                });
            });

            if (result.err) {
                return { error: `Python zip error: ${result.err.message}` };
            }

            try {
                const data = JSON.parse(result.stdout);
                if (data.error) return { error: data.error };
                return data;
            } catch {
                return { error: "Gagal parse output zip." };
            }
        } catch (e) {
            return { error: e.message };
        } finally {
            try { fs.unlinkSync(tmpZip); } catch {}
            if (!extract) {
                try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
            }
        }
    }

    _pyListScript() {
        return `
import sys, json, zipfile, os
try:
    z = zipfile.ZipFile(sys.argv[1])
    files = []
    for info in z.infolist():
        files.append({
            "name": info.filename,
            "size": info.file_size,
            "is_dir": info.is_dir()
        })
    z.close()
    print(json.dumps({"files": files}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();
    }

    _pyExtractScript() {
        return `
import sys, json, zipfile, os
try:
    zip_path = sys.argv[1]
    extract_to = sys.argv[2]
    os.makedirs(extract_to, exist_ok=True)
    z = zipfile.ZipFile(zip_path)
    # Safety: check for path traversal
    for member in z.namelist():
        target = os.path.join(extract_to, member)
        if not os.path.realpath(target).startswith(os.path.realpath(extract_to)):
            print(json.dumps({"error": f"Path traversal detected: {member}"}))
            sys.exit(1)
    z.extractall(extract_to)
    files = []
    for root, dirs, fnames in os.walk(extract_to):
        for f in fnames:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, extract_to)
            files.append({"name": rel, "size": os.path.getsize(fp)})
    z.close()
    print(json.dumps({"files": files, "extracted_to": extract_to}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();
    }

    // ---- ZIP EXTRACT + READ: extract to a stable dir and return text contents ----
    // Extracts into state/extracted/<tag>/ so files persist for later self_read.
    async extractZip(zipBuffer, tag) {
        const os = require("node:os");
        const safeTag = String(tag || "upload").replace(/[^a-zA-Z0-9_-]/g, "_");
        const tmpZip = path.join(os.tmpdir(), `alya_zip_${Date.now()}.zip`);
        const extractDir = path.join(PROJECT_ROOT, "state", "extracted", safeTag);

        try {
            fs.writeFileSync(tmpZip, zipBuffer);
            const pyScript = this._pyExtractScript();
            const result = await new Promise((resolve) => {
                const proc = execFile("python3", ["-c", pyScript, tmpZip, extractDir], {
                    timeout: 60000,
                    maxBuffer: 1024 * 1024 * 10
                }, (err, stdout, stderr) => {
                    resolve({ err, stdout, stderr });
                });
            });
            if (result.err) return { error: `Python zip error: ${result.err.message}` };
            const data = JSON.parse(result.stdout);
            if (data.error) return { error: data.error };

            // Read text contents of all extracted files
            const TEXT_EXT = /\.(txt|md|json|js|ts|html|css|yml|yaml|xml|csv|log|env|py|sh)$/i;
            const contents = [];
            for (const f of data.files) {
                if (!TEXT_EXT.test(f.name)) continue;
                try {
                    const full = path.join(extractDir, f.name);
                    const content = fs.readFileSync(full, "utf8");
                    contents.push({ name: f.name, size: f.size, content });
                } catch { /* skip binary/unreadable */ }
            }
            return { files: data.files, extracted_to: extractDir, contents };
        } catch (e) {
            return { error: e.message };
        } finally {
            try { fs.unlinkSync(tmpZip); } catch {}
        }
    }

    // ---- GIT: commit and push changes ----
    async gitCommit(message = "alya self-improvement") {
        return new Promise((resolve) => {
            const cmd = `cd ${PROJECT_ROOT} && git add -A && git commit -m ${JSON.stringify(message)} && git push origin main 2>&1`;
            exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) {
                    resolve({ error: stderr || err.message, output: stdout });
                } else {
                    resolve({ success: true, output: stdout.trim() });
                }
            });
        });
    }

    // ---- RELOAD: restart the bot process ----
    async reload() {
        // Use pm2 reload
        return new Promise((resolve) => {
            exec("pm2 reload BotWa", { timeout: 10000 }, (err, stdout, stderr) => {
                if (err) {
                    resolve({ error: stderr || err.message });
                } else {
                    resolve({ success: true });
                }
            });
        });
    }
}

module.exports = { Evolve, PROJECT_ROOT };
