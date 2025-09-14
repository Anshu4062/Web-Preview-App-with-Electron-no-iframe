import { app, BrowserWindow, BrowserView, ipcMain, Menu, nativeImage } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let previewView = null;

async function createWindow() {
    // If an SVG exists, rasterize it to a high-res PNG we can reuse
    try {
        const svgPath = path.join(__dirname, 'renderer', 'icon.svg');
        const outPng = path.join(__dirname, 'renderer', 'icon.png');
        if (fs.existsSync(svgPath)) {
            const svgBuf = fs.readFileSync(svgPath);
            let svgImage = nativeImage.createFromBuffer(svgBuf);
            if (!svgImage.isEmpty()) {
                svgImage = svgImage.resize({ width: 256, height: 256, quality: 'best' });
                const pngBuf = svgImage.toPNG();
                fs.writeFileSync(outPng, pngBuf);
            }
        }
    } catch { }

    const iconCandidates = [
        // Prefer user-provided PNGs named favicon.png
        path.join(__dirname, 'favicon.png'),
        path.join(__dirname, 'renderer', 'favicon.png'),
        // Common ICO names
        path.join(__dirname, 'renderer', 'favicon.ico'),
        path.join(__dirname, 'favicon.ico'),
        path.join(__dirname, 'renderer', 'icon.ico'),
        path.join(__dirname, 'icon.ico'),
        // Fallback PNG names
        path.join(__dirname, 'renderer', 'icon.png'),
        path.join(__dirname, 'icon.png'),
    ];
    let winIcon = null;
    for (const p of iconCandidates) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) { winIcon = img; break; }
    }
    if (winIcon) {
        const sz = winIcon.getSize();
        if (sz && (sz.width < 256 || sz.height < 256)) {
            try { winIcon = winIcon.resize({ width: 256, height: 256, quality: 'best' }); } catch { }
        }
    }
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: winIcon || undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: true
    });

    try {
        await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    } catch (e) {
        try {
            const fileUrl = `file://${path.join(__dirname, 'renderer', 'index.html').replace(/\\/g, '/')}`;
            await mainWindow.loadURL(fileUrl);
        } catch (e2) {
            console.error('Failed to load renderer HTML:', e2);
        }
    }

    // Diagnose load issues for the main window
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error('Main window failed to load', { code, desc, url });
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
        console.error('Renderer process gone', details);
    });
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Main window loaded index.html');
    });

    // Ensure window becomes visible even if ready-to-show doesn't fire
    try { mainWindow.show(); } catch { }

    // Create the website preview view
    createPreviewView();

    // Handle window resize
    mainWindow.on('resize', () => {
        resizePreview();
    });
}

function setAppMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                { label: 'Reload', role: 'reload' },
                { label: 'Force Reload', role: 'forceReload' },
                { type: 'separator' },
                { label: 'Actual Size', role: 'resetZoom' },
                { label: 'Zoom In', role: 'zoomIn' },
                { label: 'Zoom Out', role: 'zoomOut' },
                { type: 'separator' },
                { label: 'Toggle Full Screen', role: 'togglefullscreen' },
                { label: 'Toggle Developer Tools', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: 'Exit', role: 'quit' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createPreviewView() {
    if (previewView) {
        previewView.destroy();
    }

    previewView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        }
    });

    mainWindow.setBrowserView(previewView);
    resizePreview();
}

function resizePreview() {
    if (!previewView || !mainWindow) return;

    const bounds = mainWindow.getContentBounds();
    const leftPanelWidth = 400; // Fixed width for left panel

    previewView.setBounds({
        x: leftPanelWidth,
        y: 0,
        width: bounds.width - leftPanelWidth,
        height: bounds.height
    });
}

function loadWebsite(url) {
    if (!previewView) return;

    try {
        previewView.webContents.loadURL(url);

        // Simple CSS injection to remove gaps - much more conservative
        previewView.webContents.once('did-finish-load', () => {
            previewView.webContents.insertCSS(`
                body {
                    margin: 0 !important;
                    padding: 0 !important;
                }
            `);
        });
    } catch (error) {
        console.error('Error loading website:', error);
    }
}

// IPC handlers
ipcMain.handle('load-website', async (event, url) => {
    loadWebsite(url);
    return { success: true };
});

ipcMain.handle('get-preview-bounds', () => {
    if (!previewView) return null;
    return previewView.getBounds();
});

// Temporarily suspend and resume the preview view so overlay UI is clickable
ipcMain.handle('preview-suspend', () => {
    if (!mainWindow || !previewView) return { ok: false };
    const b = mainWindow.getContentBounds();
    // Move it out of view and collapse so it doesn't intercept input
    previewView.setBounds({ x: b.width, y: 0, width: 0, height: 0 });
    return { ok: true };
});

ipcMain.handle('preview-resume', () => {
    if (!mainWindow || !previewView) return { ok: false };
    resizePreview();
    return { ok: true };
});

// PACS storage helpers
const pacsFilePath = path.join(__dirname, 'pacs.json');

function readPacsFile() {
    try {
        const data = fs.readFileSync(pacsFilePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

function writePacsFile(records) {
    try {
        fs.writeFileSync(pacsFilePath, JSON.stringify(records, null, 2) + os.EOL, 'utf8');
        return true;
    } catch {
        return false;
    }
}

ipcMain.handle('pacs-save', (event, record) => {
    const records = readPacsFile();
    const withId = { id: Date.now(), ...record };
    records.push(withId);
    writePacsFile(records);
    return { ok: true, record: withId };
});

ipcMain.handle('pacs-list', () => {
    return readPacsFile();
});

ipcMain.handle('pacs-update', (event, updated) => {
    const records = readPacsFile();
    const idx = records.findIndex(r => r.id === updated.id);
    if (idx >= 0) {
        records[idx] = { ...records[idx], ...updated };
        writePacsFile(records);
        return { ok: true, record: records[idx] };
    }
    return { ok: false };
});

// Click the eye icon (load selected study)
ipcMain.handle('trigger-eye', async () => {
    if (!previewView) return { ok: false };
    try {
        const selectors = [
            'img[title*="image viewer" i]',
            '[title*="image viewer" i]',
            'img[alt*="image viewer" i]',
            'img[title*="Load selected study" i]',
            '[title*="Load selected study" i]'
        ];
        const rowSelectors = [
            'tbody tr[__gwt_row="0"][__gwt_subrow="0"]',
            'tbody tr[__gwt_row="0"]',
            '.gwt-ScrollTable table tbody tr',
            'table tbody tr',
            '[role="row"]',
            'tr'
        ];
        const did = await previewView.webContents.executeJavaScript(`
            (async function(){
                const eyeSels = ${JSON.stringify(selectors)};
                const rowSels = ${JSON.stringify(rowSelectors)};
                function firstVisible(elements){
                    for (const el of elements){ if (el && el.offsetParent !== null) return el; }
                    return null;
                }
                function clickFirstRow(){
                    // Prefer explicit GWT first data row if present
                    let best = document.querySelector('tbody tr[__gwt_row="0"][__gwt_subrow="0"]') || document.querySelector('tbody tr[__gwt_row="0"]');
                    if (!best){
                        // Fallback strategy: find all candidate rows (must contain at least one TD),
                        // keep the one with the smallest Y (closest to top) and visible.
                        let bestTop = Infinity;
                        function consider(nodes){
                            for (const el of nodes){
                                if (!el) continue;
                                const hasTd = el.querySelector && el.querySelector('td');
                                if (!hasTd) continue;
                                const r = el.getBoundingClientRect && el.getBoundingClientRect();
                                if (!r || r.height < 18 || r.width < 40) continue;
                                if (r.top < 0) continue; // skip above viewport headers
                                const style = window.getComputedStyle(el);
                                if (style.display === 'none' || style.visibility === 'hidden') continue;
                                if (r.top < bestTop) { bestTop = r.top; best = el; }
                            }
                        }
                        for (const s of rowSels){ consider(document.querySelectorAll(s)); }
                    }
                    if (best){
                        // Try to click a specific cell (3rd column typically contains patient name as per sample)
                        const nameCell = best.querySelector('td:nth-child(3) div[__gwt_cell], td:nth-child(3)');
                        const target = nameCell || best;
                        target.scrollIntoView({block:'center'});
                        target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
                        target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
                        target.dispatchEvent(new MouseEvent('click',{bubbles:true}));
                        return true;
                    }
                    return false;
                }
                // Click first study row (if any)
                clickFirstRow();
                // small delay to let selection apply
                await new Promise(r=>setTimeout(r,250));
                for (const s of eyeSels){
                    const el = document.querySelector(s);
                    if (el){ el.click(); return true; }
                }
                return false;
            })();
        `, true);
        return { ok: did };
    } catch (e) {
        return { ok: false, error: e?.message };
    }
});

app.whenReady().then(async () => {
    // Helps Windows pick up the correct taskbar icon/app identity
    try { app.setAppUserModelId('com.web-previewer.app'); } catch { }
    setAppMenu();
    await createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});