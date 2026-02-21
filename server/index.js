/**
 * Main Express server — Local Vibe Coding Backend
 * Port: 3001
 * Proxied from Vite dev server via /api/* → http://localhost:3001
 */

import express from 'express';
import cors from 'cors';
import { startPreviewServer } from './preview-server.js';

// Routes
import agentRouter from './routes/agent.js';
import appsRouter from './routes/apps.js';
import miscRouter from './routes/misc.js';

const PORT = 3001;
const app = express();

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', '*'],
    credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
    if (!req.path.includes('keepalive')) {
        console.log(`[api] ${req.method} ${req.path}`);
    }
    next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/agent', agentRouter);
app.use('/api/apps', appsRouter);
app.use('/api', miscRouter);

// Health check
app.get('/', (_req, res) => {
    res.json({
        service: 'VibeCode Local Backend',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            agent: 'POST /api/agent',
            approve: 'POST /api/agent/:sessionId/approve',
            apps: 'GET /api/apps',
            status: 'GET /api/status',
        },
        ai: 'Ollama (local)',
        previewServer: 'http://localhost:3002',
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
    // Start preview server first
    await startPreviewServer();

    // Start main API server
    app.listen(PORT, () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║   VibeCode Local Backend — Running!          ║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  API:     http://localhost:${PORT}               ║`);
        console.log('║  Preview: http://localhost:3002              ║');
        console.log('║  Ollama:  http://localhost:11434             ║');
        console.log('╚══════════════════════════════════════════════╝');
        console.log('');
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
