/**
 * Agent route — core AI generation: blueprint → approve → build
 * Uses SSE (Server-Sent Events) to stream progress to the frontend
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { generate, generateStream, getBestCodingModel } from '../ollama.js';
import { BLUEPRINT_SYSTEM, CODE_SYSTEM, blueprintPrompt, codePrompt } from '../prompts.js';
import { APPS_DIR } from './apps.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In-memory session store: sessionId → { blueprint, query, appId, status }
const sessions = new Map();

// ─── SSE Helper ──────────────────────────────────────────────────────────────

function sseSetup(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
}

function sseSend(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
}

// ─── POST /api/agent ──────────────────────────────────────────────────────────
// Start a new agent session: generate blueprint, stream it back

router.post('/', async (req, res) => {
    const { query, projectType = 'app' } = req.body || {};

    if (!query || !query.trim()) {
        return res.status(400).json({ success: false, error: { message: 'Query is required' } });
    }

    sseSetup(res);

    const sessionId = nanoid();
    const appId = nanoid(12);

    try {
        // ── Phase 1: Generate Blueprint ──────────────────────────────────────────
        sseSend(res, 'status', {
            type: 'thinking',
            message: '🤔 Analyzing your request with Llama 3...',
            sessionId,
        });

        const model = await getBestCodingModel();
        console.log(`[agent] Using model: ${model} for query: "${query}"`);

        let blueprintRaw = '';
        try {
            blueprintRaw = await generate(model, blueprintPrompt(query), BLUEPRINT_SYSTEM);
        } catch (err) {
            sseSend(res, 'error', { message: `Ollama error: ${err.message}. Is Ollama running?` });
            return res.end();
        }

        // Parse JSON — find the JSON object in the response
        let blueprint;
        try {
            // Extract JSON from response (may have surrounding text)
            const match = blueprintRaw.match(/\{[\s\S]*\}/);
            if (!match) throw new Error('No JSON found in response');
            blueprint = JSON.parse(match[0]);
        } catch (parseErr) {
            console.error('[agent] Blueprint parse error:', parseErr.message);
            console.error('[agent] Raw response:', blueprintRaw.slice(0, 500));
            // Fallback blueprint
            blueprint = {
                title: query.slice(0, 60),
                description: `A web application: ${query}`,
                techStack: ['HTML', 'CSS', 'JavaScript'],
                files: [
                    { path: 'index.html', description: 'Main HTML', type: 'html' },
                    { path: 'style.css', description: 'Styles', type: 'css' },
                    { path: 'app.js', description: 'Application logic', type: 'javascript' },
                ],
                features: [query],
                colorScheme: 'dark',
            };
        }

        // Store session
        sessions.set(sessionId, {
            blueprint,
            query,
            appId,
            projectType,
            model,
            status: 'awaiting_approval',
        });

        // Stream the blueprint to the frontend
        sseSend(res, 'blueprint', {
            sessionId,
            appId,
            blueprint,
        });

        sseSend(res, 'status', {
            type: 'blueprint_ready',
            message: '📋 Blueprint ready! Review and approve to start building.',
            sessionId,
        });

        // Keep connection alive until approved or 5min timeout
        let approved = false;
        const cleanup = () => {
            clearInterval(keepAlive);
            clearTimeout(timeout);
        };

        const keepAlive = setInterval(() => {
            res.write(': keepalive\n\n');
            if (res.flush) res.flush();
        }, 15000);

        const timeout = setTimeout(() => {
            cleanup();
            sseSend(res, 'error', { message: 'Session timed out. Please try again.' });
            sessions.delete(sessionId);
            res.end();
        }, 5 * 60 * 1000);

        // Listen for approval event on the session
        const checkApproval = setInterval(async () => {
            const session = sessions.get(sessionId);
            if (!session) {
                clearInterval(checkApproval);
                cleanup();
                res.end();
                return;
            }

            if (session.status === 'approved') {
                clearInterval(checkApproval);
                cleanup();
                approved = true;

                // ── Phase 2: Build ───────────────────────────────────────────────────
                await runBuild(res, session, sessionId);
                sessions.delete(sessionId);
                res.end();
            } else if (session.status === 'rejected') {
                clearInterval(checkApproval);
                cleanup();
                sseSend(res, 'status', { type: 'cancelled', message: 'Build cancelled.' });
                sessions.delete(sessionId);
                res.end();
            }
        }, 500);

        req.on('close', () => {
            clearInterval(checkApproval);
            cleanup();
            if (!approved) sessions.delete(sessionId);
        });

    } catch (err) {
        console.error('[agent] Error:', err);
        sseSend(res, 'error', { message: err.message });
        res.end();
    }
});

// ─── POST /api/agent/:sessionId/approve ──────────────────────────────────────

router.post('/:sessionId/approve', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    session.status = 'approved';
    res.json({ success: true, data: { sessionId, appId: session.appId } });
});

// ─── POST /api/agent/:sessionId/reject ───────────────────────────────────────

router.post('/:sessionId/reject', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (session) session.status = 'rejected';
    res.json({ success: true });
});

// ─── Build Function ───────────────────────────────────────────────────────────

async function runBuild(res, session, sessionId) {
    const { blueprint, query, appId, model } = session;

    sseSend(res, 'status', {
        type: 'building',
        message: `🚀 Building "${blueprint.title}" with ${model}...`,
        sessionId,
    });

    // Create app directory
    const appDir = path.join(APPS_DIR, appId);
    fs.mkdirSync(appDir, { recursive: true });

    const generatedFiles = {};

    // Generate each file
    for (let i = 0; i < blueprint.files.length; i++) {
        const file = blueprint.files[i];

        sseSend(res, 'file_start', {
            file: file.path,
            index: i,
            total: blueprint.files.length,
            message: `📝 Generating ${file.path}...`,
        });

        let content = '';
        try {
            await generateStream(
                model,
                codePrompt(blueprint, file, blueprint.files),
                CODE_SYSTEM,
                (chunk) => {
                    content += chunk;
                    // Stream token chunks to frontend
                    sseSend(res, 'file_chunk', {
                        file: file.path,
                        chunk,
                    });
                }
            );
        } catch (err) {
            sseSend(res, 'error', { message: `Failed to generate ${file.path}: ${err.message}` });
            return;
        }

        // Clean up any markdown fences from the output
        content = content
            .replace(/^```[\w]*\n?/gm, '')
            .replace(/```\s*$/gm, '')
            .trim();

        generatedFiles[file.path] = content;

        // Write file to disk
        const filePath = path.join(appDir, file.path);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');

        sseSend(res, 'file_complete', {
            file: file.path,
            size: content.length,
            content,
        });
    }

    // Save metadata
    const meta = {
        id: appId,
        title: blueprint.title,
        description: blueprint.description,
        query,
        techStack: blueprint.techStack,
        features: blueprint.features,
        files: blueprint.files.map(f => f.path),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        visibility: 'private',
        userId: 'local-user',
        previewUrl: `http://localhost:3002/${appId}/index.html`,
        sessionId,
        status: 'completed',
    };

    fs.writeFileSync(path.join(appDir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Done!
    sseSend(res, 'complete', {
        appId,
        title: blueprint.title,
        files: generatedFiles,
        previewUrl: `http://localhost:3002/${appId}/index.html`,
        message: '✅ Build complete! Your app is ready.',
    });
}

// ─── GET /api/agent/:agentId/analytics ───────────────────────────────────────

router.get('/:agentId/analytics', (_req, res) => {
    res.json({ success: true, data: {} });
});

// ─── GET /api/agent/connection ────────────────────────────────────────────────

router.get('/connection', (_req, res) => {
    res.json({
        success: true,
        data: {
            connected: true,
            provider: 'ollama',
            model: 'llama3:latest',
        },
    });
});

export default router;
