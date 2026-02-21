/**
 * core.ts
 *
 * Core inference utilities for LLM communication.
 *
 * This module handles:
 * - Streaming inference with real-time chunk processing
 * - Multi-provider LLM abstraction (OpenAI, Anthropic, Google, etc.)
 * - Tool calling protocol implementation
 * - Response parsing and validation
 * - Error handling and retry logic
 */

import { z } from 'zod';
import { Logger } from '../../../logger';
import { IInferenceContext } from './config';
import { Message, ConversationMessage } from './common';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Inference response types
 */
export type InferResponse =
	| InferResponseText
	| InferResponseToolCalls
	| InferResponseStream;

export interface InferResponseText {
	type: 'text';
	content: string;
	usage?: TokenUsage;
}

export interface InferResponseToolCalls {
	type: 'tool_calls';
	content: string;
	tool_calls: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
	usage?: TokenUsage;
}

export interface InferResponseStream {
	type: 'stream';
	stream: AsyncIterable<StreamChunk>;
}

export interface InferResponseString {
	string: string;
	usage?: TokenUsage;
}

/**
 * Token usage information
 */
export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

/**
 * Stream chunk types
 */
export type StreamChunk =
	| StreamChunkContent
	| StreamChunkToolCall
	| StreamChunkComplete;

export interface StreamChunkContent {
	type: 'content';
	content: string;
}

export interface StreamChunkToolCall {
	type: 'tool_call';
	tool_calls: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
}

export interface StreamChunkComplete {
	type: 'complete';
}

/**
 * Tool schema for function calling
 */
export interface ToolSchema {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: z.ZodTypeAny | Record<string, unknown>;
	};
}

/**
 * Inference options
 */
export interface InferOptions {
	env: Env;
	inferenceContext: IInferenceContext;
	messages: Message[];
	tools?: ToolSchema[];
	tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
}

/**
 * Custom abort error for cancellation
 */
export class AbortError extends Error {
	constructor(message: string = 'Operation aborted') {
		super(message);
		this.name = 'AbortError';
	}
}

// ============================================================================
// MAIN INFERENCE FUNCTIONS
// ============================================================================

/**
 * Execute streaming inference
 * Primary entry point for AI communication with real-time updates
 */
export async function inferStream(
	options: InferOptions
): Promise<AsyncIterable<StreamChunk>> {
	const { env, inferenceContext, messages, tools, temperature, max_tokens } = options;
	const { logger, provider, model } = inferenceContext;

	logger.info('Starting streaming inference', {
		provider,
		model,
		messageCount: messages.length,
		toolCount: tools?.length || 0,
	});

	try {
		// Route to appropriate provider implementation
		switch (provider) {
			case 'anthropic':
				return streamAnthropic(env, model, messages, tools, temperature, max_tokens, logger);

			case 'openai':
				return streamOpenAI(env, model, messages, tools, temperature, max_tokens, logger);

			case 'google':
				return streamGoogle(env, model, messages, tools, temperature, max_tokens, logger);

			case 'cerebras':
				return streamCerebras(env, model, messages, tools, temperature, max_tokens, logger);

			case 'cloudflare':
				return streamCloudflare(env, model, messages, tools, temperature, max_tokens, logger);

			default:
				throw new Error(`Unknown provider: ${provider}`);
		}

	} catch (error) {
		logger.error('Streaming inference failed', error);
		throw error;
	}
}

/**
 * Non-streaming inference for simple requests
 */
export async function infer(
	options: InferOptions
): Promise<InferResponse> {
	const { stream, ...rest } = options;

	if (stream) {
		const streamIterator = await inferStream(rest);
		// Collect all chunks
		let content = '';
		let toolCalls: StreamChunkToolCall['tool_calls'] | undefined;

		for await (const chunk of streamIterator) {
			if (chunk.type === 'content') {
				content += chunk.content;
			}
			if (chunk.type === 'tool_call') {
				toolCalls = chunk.tool_calls;
			}
		}

		if (toolCalls) {
			return {
				type: 'tool_calls',
				content,
				tool_calls: toolCalls,
			};
		}

		return {
			type: 'text',
			content,
		};
	}

	// Non-streaming implementation
	return inferNonStreaming(options);
}

// ============================================================================
// PROVIDER IMPLEMENTATIONS
// ============================================================================

/**
 * Anthropic Claude streaming implementation
 */
async function streamAnthropic(
	env: Env,
	model: string,
	messages: Message[],
	tools: ToolSchema[] | undefined,
	temperature: number | undefined,
	maxTokens: number | undefined,
	logger: Logger
): Promise<AsyncIterable<StreamChunk>> {
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error('ANTHROPIC_API_KEY not configured');
	}

	// Convert messages to Anthropic format
	const anthropicMessages = messages.map(m => ({
		role: m.role === 'tool' ? 'user' : m.role,
		content: m.content,
		...(m.tool_calls && { tool_calls: m.tool_calls }),
		...(m.tool_call_id && { tool_use_id: m.tool_call_id }),
	}));

	// Convert tools to Anthropic format
	const anthropicTools = tools?.map(t => ({
		name: t.function.name,
		description: t.function.description,
		input_schema: t.function.parameters,
	}));

	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true',
		},
		body: JSON.stringify({
			model,
			messages: anthropicMessages,
			...(anthropicTools && { tools: anthropicTools }),
			...(temperature && { temperature }),
			...(maxTokens && { max_tokens: maxTokens }),
			stream: true,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Anthropic API error: ${response.status} - ${error}`);
	}

	// Create async iterator from SSE stream
	return createStreamIterator(response.body!, logger, 'anthropic');
}

/**
 * OpenAI GPT streaming implementation
 */
async function streamOpenAI(
	env: Env,
	model: string,
	messages: Message[],
	tools: ToolSchema[] | undefined,
	temperature: number | undefined,
	maxTokens: number | undefined,
	logger: Logger
): Promise<AsyncIterable<StreamChunk>> {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error('OPENAI_API_KEY not configured');
	}

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages,
			...(tools && { tools }),
			...(temperature && { temperature }),
			...(maxTokens && { max_tokens: maxTokens }),
			stream: true,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	return createStreamIterator(response.body!, logger, 'openai');
}

/**
 * Google Gemini streaming implementation
 */
async function streamGoogle(
	env: Env,
	model: string,
	messages: Message[],
	tools: ToolSchema[] | undefined,
	temperature: number | undefined,
	maxTokens: number | undefined,
	logger: Logger
): Promise<AsyncIterable<StreamChunk>> {
	const apiKey = env.GOOGLE_API_KEY;
	if (!apiKey) {
		throw new Error('GOOGLE_API_KEY not configured');
	}

	// Convert to Gemini format
	const geminiMessages = messages.map(m => ({
		role: m.role === 'assistant' ? 'model' : m.role,
		parts: [{ text: m.content }],
	}));

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: geminiMessages,
				...(temperature && { generationConfig: { temperature } }),
				...(maxTokens && { generationConfig: { maxOutputTokens: maxTokens } }),
			}),
		}
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Google API error: ${response.status} - ${error}`);
	}

	return createStreamIterator(response.body!, logger, 'google');
}

/**
 * Cerebras fast inference implementation
 */
async function streamCerebras(
	env: Env,
	model: string,
	messages: Message[],
	tools: ToolSchema[] | undefined,
	temperature: number | undefined,
	maxTokens: number | undefined,
	logger: Logger
): Promise<AsyncIterable<StreamChunk>> {
	const apiKey = env.CEREBRAS_API_KEY;
	if (!apiKey) {
		throw new Error('CEREBRAS_API_KEY not configured');
	}

	const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages,
			...(tools && { tools }),
			...(temperature && { temperature }),
			...(maxTokens && { max_tokens: maxTokens }),
			stream: true,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cerebras API error: ${response.status} - ${error}`);
	}

	return createStreamIterator(response.body!, logger, 'cerebras');
}

/**
 * Cloudflare AI Gateway implementation
 */
async function streamCloudflare(
	env: Env,
	model: string,
	messages: Message[],
	tools: ToolSchema[] | undefined,
	temperature: number | undefined,
	maxTokens: number | undefined,
	logger: Logger
): Promise<AsyncIterable<StreamChunk>> {
	// Use Cloudflare AI Gateway for unified access
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID;

	const response = await fetch(
		`https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/v1/chat/completions`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
			},
			body: JSON.stringify({
				model,
				messages,
				...(tools && { tools }),
				...(temperature && { temperature }),
				...(maxTokens && { max_tokens: maxTokens }),
				stream: true,
			}),
		}
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cloudflare AI error: ${response.status} - ${error}`);
	}

	return createStreamIterator(response.body!, logger, 'cloudflare');
}

/**
 * Non-streaming fallback implementation
 */
async function inferNonStreaming(options: InferOptions): Promise<InferResponse> {
	// Implementation for non-streaming requests
	// Used for simple queries where real-time updates aren't needed
	const { env, inferenceContext, messages, tools } = options;

	// Default to OpenAI for non-streaming
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error('OPENAI_API_KEY not configured');
	}

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: inferenceContext.model,
			messages,
			...(tools && { tools }),
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	const data = await response.json();

	return {
		type: 'text',
		content: data.choices[0].message.content,
		usage: data.usage,
	};
}

// ============================================================================
// STREAM PROCESSING
// ============================================================================

/**
 * Create async iterator from SSE stream
 */
async function* createStreamIterator(
	body: ReadableStream<Uint8Array>,
	logger: Logger,
	provider: string
): AsyncGenerator<StreamChunk> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim() === '' || !line.startsWith('data:')) continue;

				const data = line.slice(5).trim();
				if (data === '[DONE]') {
					yield { type: 'complete' };
					return;
				}

				try {
					const parsed = JSON.parse(data);
					const chunk = parseStreamChunk(parsed, provider);
					if (chunk) yield chunk;
				} catch (error) {
					logger.warn('Failed to parse stream chunk', { line, error });
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * Parse provider-specific stream chunk to unified format
 */
function parseStreamChunk(data: unknown, provider: string): StreamChunk | null {
	switch (provider) {
		case 'anthropic':
			return parseAnthropicChunk(data);
		case 'openai':
		case 'cloudflare':
		case 'cerebras':
			return parseOpenAIChunk(data);
		case 'google':
			return parseGoogleChunk(data);
		default:
			return null;
	}
}

/**
 * Parse Anthropic-specific chunk
 */
function parseAnthropicChunk(data: any): StreamChunk | null {
	if (data.type === 'content_block_delta' && data.delta?.text) {
		return {
			type: 'content',
			content: data.delta.text,
		};
	}
	if (data.type === 'tool_use') {
		return {
			type: 'tool_call',
			tool_calls: [{
				id: data.id,
				type: 'function',
				function: {
					name: data.name,
					arguments: JSON.stringify(data.input),
				},
			}],
		};
	}
	return null;
}

/**
 * Parse OpenAI-compatible chunk
 */
function parseOpenAIChunk(data: any): StreamChunk | null {
	const delta = data.choices?.[0]?.delta;
	if (!delta) return null;

	if (delta.content) {
		return {
			type: 'content',
			content: delta.content,
		};
	}

	if (delta.tool_calls) {
		return {
			type: 'tool_call',
			tool_calls: delta.tool_calls.map((tc: any) => ({
				id: tc.id,
				type: 'function',
				function: {
					name: tc.function?.name || '',
					arguments: tc.function?.arguments || '',
				},
			})),
		};
	}

	return null;
}

/**
 * Parse Google-specific chunk
 */
function parseGoogleChunk(data: any): StreamChunk | null {
	if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
		return {
			type: 'content',
			content: data.candidates[0].content.parts[0].text,
		};
	}
	return null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Prepare messages for inference with image support
 */
export async function prepareMessagesForInference(
	env: Env,
	messages: ConversationMessage[]
): Promise<Message[]> {
	return Promise.all(messages.map(async (msg) => {
		// Handle image attachments if present
		if (msg.images && msg.images.length > 0) {
			const imageContents = await Promise.all(
				msg.images.map(async (img) => {
					// Fetch image and convert to base64 if needed
					return {
						type: 'image_url',
						image_url: { url: img.url },
					};
				})
			);

			return {
				...msg,
				content: [
					{ type: 'text', text: msg.content },
					...imageContents,
				],
			} as Message;
		}

		return msg as Message;
	}));
}

/**
 * Estimate token count (rough approximation)
 */
export function estimateTokens(text: string): number {
	// Rough estimate: 1 token ≈ 4 characters for English
	return Math.ceil(text.length / 4);
}

/**
 * Truncate messages to fit within token limit
 */
export function truncateMessages(
	messages: Message[],
	maxTokens: number
): Message[] {
	let totalTokens = 0;
	const result: Message[] = [];

	// Add messages from most recent to oldest
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const content = typeof msg.content === 'string'
			? msg.content
			: JSON.stringify(msg.content);
		const tokens = estimateTokens(content);

		if (totalTokens + tokens > maxTokens && result.length > 0) {
			break; // Stop if we'd exceed limit (but keep at least one message)
		}

		totalTokens += tokens;
		result.unshift(msg);
	}

	return result;
}

/**
 * Retry wrapper with exponential backoff
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries?: number;
		baseDelay?: number;
		maxDelay?: number;
		shouldRetry?: (error: Error) => boolean;
	} = {}
): Promise<T> {
	const {
		maxRetries = 3,
		baseDelay = 1000,
		maxDelay = 30000,
		shouldRetry = () => true,
	} = options;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (!shouldRetry(lastError) || attempt === maxRetries - 1) {
				throw lastError;
			}

			const delay = Math.min(
				baseDelay * Math.pow(2, attempt),
				maxDelay
			);
			await new Promise(r => setTimeout(r, delay));
		}
	}

	throw lastError!;
}
