/**
 * Ollama API client — wraps HTTP calls to local Ollama (:11434)
 */

const OLLAMA_BASE = 'http://localhost:11434';

/**
 * List available models
 */
export async function listModels() {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    const data = await res.json();
    return data.models || [];
}

/**
 * Best coding model available locally
 */
export async function getBestCodingModel() {
    const models = await listModels();
    const names = models.map(m => m.name);
    // Prefer codellama, then deepseek-coder, then llama3
    for (const pref of ['codellama', 'deepseek-coder', 'llama3:latest', 'llama3']) {
        if (names.some(n => n.startsWith(pref.split(':')[0]))) {
            return names.find(n => n.startsWith(pref.split(':')[0]));
        }
    }
    return names[0] || 'llama3';
}

/**
 * Non-streaming generate — waits for full response
 */
export async function generate(model, prompt, system = '') {
    const body = {
        model,
        prompt,
        stream: false,
        ...(system && { system }),
        options: {
            temperature: 0.2,
            num_ctx: 8192,
        },
    };

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.response || '';
}

/**
 * Streaming generate — calls onChunk(text) for each token
 */
export async function generateStream(model, prompt, system = '', onChunk) {
    const body = {
        model,
        prompt,
        stream: true,
        ...(system && { system }),
        options: {
            temperature: 0.2,
            num_ctx: 8192,
        },
    };

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const obj = JSON.parse(line);
                if (obj.response) onChunk(obj.response);
                if (obj.done) return;
            } catch {
                // ignore parse errors on partial lines
            }
        }
    }
}
