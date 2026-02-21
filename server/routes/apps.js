/**
 * Apps API routes — serves apps from local filesystem storage
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.join(__dirname, '../../generated-apps');

function ensureAppsDir() {
    if (!fs.existsSync(APPS_DIR)) fs.mkdirSync(APPS_DIR, { recursive: true });
}

function loadApps() {
    ensureAppsDir();
    const entries = fs.readdirSync(APPS_DIR, { withFileTypes: true });
    return entries
        .filter(e => e.isDirectory())
        .map(e => {
            const metaPath = path.join(APPS_DIR, e.name, 'meta.json');
            if (fs.existsSync(metaPath)) {
                try {
                    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                } catch { return null; }
            }
            return null;
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// GET /api/apps — user's apps
router.get('/', (_req, res) => {
    try {
        const apps = loadApps();
        res.json({ success: true, data: { apps, total: apps.length } });
    } catch (e) {
        res.json({ success: true, data: { apps: [], total: 0 } });
    }
});

// GET /api/apps/recent
router.get('/recent', (_req, res) => {
    try {
        const apps = loadApps().slice(0, 10);
        res.json({ success: true, data: { apps, total: apps.length } });
    } catch {
        res.json({ success: true, data: { apps: [], total: 0 } });
    }
});

// GET /api/apps/favorites
router.get('/favorites', (_req, res) => {
    res.json({ success: true, data: { apps: [], total: 0 } });
});

// GET /api/apps/public — community apps
router.get('/public', (_req, res) => {
    try {
        const apps = loadApps().map(a => ({ ...a, visibility: 'public' }));
        res.json({ success: true, data: { apps, total: apps.length, page: 1, totalPages: 1 } });
    } catch {
        res.json({ success: true, data: { apps: [], total: 0, page: 1, totalPages: 1 } });
    }
});

// GET /api/apps/:id — single app details
router.get('/:id', (req, res) => {
    try {
        const metaPath = path.join(APPS_DIR, req.params.id, 'meta.json');
        if (fs.existsSync(metaPath)) {
            const app = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            // Also load files
            const appDir = path.join(APPS_DIR, req.params.id);
            const fileEntries = fs.readdirSync(appDir).filter(f => f !== 'meta.json');
            const files = {};
            for (const f of fileEntries) {
                files[f] = fs.readFileSync(path.join(appDir, f), 'utf8');
            }
            res.json({ success: true, data: { app: { ...app, files } } });
        } else {
            res.status(404).json({ success: false, error: { message: 'App not found' } });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: { message: e.message } });
    }
});

// DELETE /api/apps/:id
router.delete('/:id', (req, res) => {
    try {
        const appDir = path.join(APPS_DIR, req.params.id);
        if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true });
        res.json({ success: true, data: { deleted: true } });
    } catch (e) {
        res.status(500).json({ success: false, error: { message: e.message } });
    }
});

// POST /api/apps/:id/star, /api/apps/:id/favorite
router.post('/:id/star', (_req, res) => res.json({ success: true, data: { starred: true } }));
router.post('/:id/favorite', (_req, res) => res.json({ success: true, data: { favorited: true } }));

export { APPS_DIR };
export default router;
