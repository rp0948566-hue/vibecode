import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

// Cloudflare plugin disabled for local dev without CF credentials
// import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
	optimizeDeps: {
		exclude: ['format', 'editor.all'],
		include: ['monaco-editor/esm/vs/editor/editor.api'],
		force: true,
	},
	plugins: [
		react(),
		svgr(),
		// cloudflare({ configPath: 'wrangler.jsonc' }),
		tailwindcss(),
	],

	resolve: {
		alias: {
			debug: 'debug/src/browser',
			'@': path.resolve(__dirname, './src'),
			'shared': path.resolve(__dirname, './shared'),
			'worker': path.resolve(__dirname, './worker'),
		},
	},

	define: {
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
		global: 'globalThis',
	},

	worker: { format: 'es' },

	server: {
		host: '0.0.0.0',
		port: 5173,
		allowedHosts: true,
		// Proxy all /api/* requests to our local Express backend
		proxy: {
			'/api': {
				target: 'http://localhost:3001',
				changeOrigin: true,
				// SSE streaming needs these settings
				configure: (proxy) => {
					proxy.on('error', (err) => {
						console.log('[proxy] error', err);
					});
				},
			},
		},
	},

	cacheDir: 'node_modules/.vite',
});
