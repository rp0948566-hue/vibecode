/**
 * Misc API routes — mock responses so the frontend doesn't error
 * Uses middleware approach for catch-all routes (Express 5 compatible)
 */

import express from 'express';
const router = express.Router();

// ─── Status ────────────────────────────────────────────────────────────────

router.get('/status', (_req, res) => {
    res.json({
        success: true,
        data: { status: 'operational', version: '1.5.0', ai: 'ollama-local' },
    });
});

// ─── Capabilities ──────────────────────────────────────────────────────────

router.get('/capabilities', (_req, res) => {
    res.json({
        success: true,
        data: {
            features: [
                { id: 'app', label: 'App', description: 'Build web applications', enabled: true },
            ],
            maxFileSize: 10485760,
            supportedFrameworks: ['html', 'css', 'javascript'],
        },
    });
});

// ─── Auth (no-op, always authenticated) ───────────────────────────────────

router.get('/auth/profile', (_req, res) => {
    res.json({
        success: true,
        data: {
            user: { id: 'local-user', email: 'local@vibecode.dev', displayName: 'Local User', emailVerified: true },
            sessionId: 'local-session',
        },
    });
});

router.get('/auth/providers', (_req, res) => {
    res.json({
        success: true,
        data: { providers: { google: false, github: false, email: false }, hasOAuth: false, requiresEmailAuth: false },
    });
});

router.get('/auth/csrf-token', (_req, res) => {
    res.json({ success: true, data: { token: 'local-csrf-token', expiresIn: 86400 } });
});

// ─── Model configs ─────────────────────────────────────────────────────────

router.get('/model-configs', (_req, res) => {
    res.json({
        success: true,
        data: {
            configs: [{ id: 'local-llama3', name: 'Llama 3 (Local)', provider: 'ollama', model: 'llama3:latest', isDefault: true }],
        },
    });
});

// ─── Catch-all middleware for remaining /api/* ─────────────────────────────
// Returns 200 with empty data for any unmatched route

router.use((req, res) => {
    // Return appropriate empty responses based on path
    if (req.path.includes('/apps') || req.path.includes('/user')) {
        return res.json({ success: true, data: { apps: [], total: 0 } });
    }
    if (req.path.includes('list') || req.path.includes('templates')) {
        return res.json({ success: true, data: [] });
    }
    res.json({ success: true, data: {} });
});

export default router;
