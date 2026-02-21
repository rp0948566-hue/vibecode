/**
 * Preview server — serves generated apps as static files on port 3002
 * http://localhost:3002/{appId}/index.html
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.join(__dirname, '../generated-apps');
const PORT = 3002;

const app = express();

// CORS — allow Vite dev server to embed in iframe
app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', '');
    next();
});

// Serve generated apps
app.use('/:appId', (req, res, next) => {
    const appDir = path.join(APPS_DIR, req.params.appId);
    if (fs.existsSync(appDir)) {
        express.static(appDir)(req, res, next);
    } else {
        res.status(404).send(`<h1>App "${req.params.appId}" not found</h1>`);
    }
});

app.get('/', (_req, res) => {
    res.send(`
    <html>
    <body style="font-family:monospace;background:#0d1117;color:#58a6ff;padding:2rem">
    <h1>VibeCode Preview Server</h1>
    <p>Access your apps at <code>http://localhost:3002/{appId}/index.html</code></p>
    </body>
    </html>
  `);
});

export function startPreviewServer() {
    return new Promise((resolve) => {
        app.listen(PORT, () => {
            console.log(`[preview] Preview server running at http://localhost:${PORT}`);
            resolve();
        });
    });
}
