/**
 * common.ts
 *
 * Base classes and types for agent operations.
 *
 * This file defines the operation pattern used throughout VibeSDK:
 * - AgentOperation: Base class for all operations
 * - AgentOperationWithTools: Extension for tool-calling operations
 * - ToolSession: Session state for tool execution
 * - ToolCallbacks: Callbacks for streaming and UI updates
 *
 * Operations are the building blocks of agent behavior - each represents
 * a discrete unit of work (generate blueprint, implement phase, etc.)
 */

import { Logger } from '../../../logger';
import { InferResponse, InferResponseString, inferStream } from '../inferutils/core';
import { IInferenceContext } from '../inferutils/config';
import { ToolDefinition, ToolCall, ToolResult } from '../tools/types';
import { Message } from '../inferutils/common';
import { GenerationContext } from '../domain/values/GenerationContext';
import { ICodingAgent } from '../services/interfaces/ICodingAgent';
import { RenderToolCall } from './UserConversationProcessor';

// ============================================================================
// OPERATION OPTIONS
// ============================================================================

/**
 * Options passed to all operations
 * Provides access to infrastructure services
 */
export interface OperationOptions<Context extends GenerationContext = GenerationContext> {
	/** Environment bindings */
	env: Env;

	/** Unique agent ID */
	agentId: string;

	/** Generation context */
	context: Context;

	/** Logger instance */
	logger: Logger;

	/** Inference context for LLM calls */
	inferenceContext: IInferenceContext;

	/** Reference to parent agent for callbacks */
	agent: ICodingAgent;
}

// ============================================================================
// TOOL SESSION & CALLBACKS
// ============================================================================

/**
 * Base session interface for tool execution
 * Extended by specific operations to add their own state
 */
export interface ToolSession {
	/** Reference to parent agent */
	agent: ICodingAgent;

	/** Dynamic hints for the AI based on current state */
	dynamicHints: string;
}

/**
 * Callbacks for tool execution UI updates
 */
export interface ToolCallbacks {
	/** Stream chunks to client */
	streamCb?: (chunk: string) => void;

	/** Render tool call in UI */
	toolRenderer: RenderToolCall;

	/** Called when tool completes */
	onToolComplete?: (message: Message) => Promise<void>;

	/** Called when assistant sends message */
	onAssistantMessage?: (message: Message) => Promise<void>;
}

// ============================================================================
// BASE OPERATION CLASS
// ============================================================================

/**
 * Abstract base class for all agent operations
 *
 * Operations encapsulate discrete units of work in the generation pipeline.
 * They follow a consistent pattern: build inputs -> execute -> return outputs.
 */
export abstract class AgentOperation<
	Inputs,
	Outputs,
	Session = unknown
> {
	/**
	 * Execute the operation
	 * Template method pattern - subclasses override specific steps
	 */
	async execute(inputs: Inputs, options: OperationOptions): Promise<Outputs> {
		const startTime = Date.now();
		const { logger } = options;

		logger.info(`Starting operation: ${this.constructor.name}`);

		try {
			// Build session state
			const session = this.buildSession(inputs, options);

			// Execute core logic
			const result = await this.executeCore(inputs, options, session);

			const duration = Date.now() - startTime;
			logger.info(`Operation completed: ${this.constructor.name}`, { duration });

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			logger.error(`Operation failed: ${this.constructor.name}`, {
				error,
				duration
			});
			throw error;
		}
	}

	/**
	 * Build session state for this operation
	 * Override to add operation-specific state
	 */
	protected abstract buildSession(
		inputs: Inputs,
		options: OperationOptions
	): Session;

	/**
	 * Core execution logic
	 */
	protected abstract executeCore(
		inputs: Inputs,
		options: OperationOptions,
		session: Session
	): Promise<Outputs>;
}

// ============================================================================
// TOOL-BASED OPERATION CLASS
// ============================================================================

/**
 * Operation that uses tool-calling (function calling) with LLMs
 *
 * This is the most common operation type in VibeSDK. It:
 * 1. Builds a system prompt and user message
 * 2. Provides tools the AI can call
 * 3. Handles tool execution loops
 * 4. Streams responses for real-time UX
 */
export abstract class AgentOperationWithTools<
	Context extends GenerationContext,
	Inputs,
	Outputs,
	Session extends ToolSession
> extends AgentOperation<Inputs, Outputs, Session> {

	/** Maximum tool call iterations to prevent infinite loops */
	protected readonly MAX_TOOL_ITERATIONS = 50;

	/** Maximum time for operation (5 minutes) */
	protected readonly MAX_OPERATION_TIME_MS = 5 * 60 * 1000;

	/**
	 * Build messages for inference
	 */
	protected abstract buildMessages(
		inputs: Inputs,
		options: OperationOptions<Context>,
		session: Session
	): Promise<Message[]>;

	/**
	 * Build tools available to the AI
	 */
	protected abstract buildTools(
		inputs: Inputs,
		options: OperationOptions<Context>,
		session: Session,
		callbacks: ToolCallbacks
	): ToolDefinition<unknown, unknown>[];

	/**
	 * Get agent configuration
	 */
	protected abstract getAgentConfig(
		inputs: Inputs,
		options: OperationOptions<Context>,
		session: Session
	): AgentConfig;

	/**
	 * Map inference result to operation output
	 */
	protected abstract mapResultToOutput(
		inputs: Inputs,
		options: OperationOptions<Context>,
		session: Session,
		result: InferResponseString
	): Outputs;

	/**
	 * Get callbacks for tool execution
	 */
	protected abstract getCallbacks(
		inputs: Inputs,
		options: OperationOptions<Context>
	): ToolCallbacks;

	/**
	 * Core execution with tool calling loop
	 */
	protected async executeCore(
		inputs: Inputs,
		options: OperationOptions<Context>,
		session: Session
	): Promise<Outputs> {
		const { env, logger, inferenceContext } = options;
		const callbacks = this.getCallbacks(inputs, options);

		// Build messages and tools
		const messages = await this.buildMessages(inputs, options, session);
		const tools = this.buildTools(inputs, options, session, callbacks);
		const config = this.getAgentConfig(inputs, options, session);

		logger.info('Starting tool-calling operation', {
			toolCount: tools.length,
			messageCount: messages.length,
			agentAction: config.agentActionName,
		});

		// Execute inference with tool calling
		const result = await this.runInferenceWithTools(
			env,
			inferenceContext,
			messages,
			tools,
			config,
			callbacks,
			logger
		);

		// Map result to output format
		return this.mapResultToOutput(inputs, options, session, result);
	}

	/**
	 * Run inference with tool calling loop
	 * Handles the conversation loop: AI -> tool call -> result -> AI ...
	 */
	private async runInferenceWithTools(
		env: Env,
		inferenceContext: IInferenceContext,
		messages: Message[],
		tools: ToolDefinition<unknown, unknown>[],
		config: AgentConfig,
		callbacks: ToolCallbacks,
		logger: Logger
	): Promise<InferResponseString> {
		let iteration = 0;
		let currentMessages = [...messages];
		const startTime = Date.now();

		while (iteration < this.MAX_TOOL_ITERATIONS) {
			// Check timeout
			if (Date.now() - startTime > this.MAX_OPERATION_TIME_MS) {
				throw new Error('Operation timeout exceeded');
			}

			// Stream inference
			const response = await this.streamInference(
				env,
				inferenceContext,
				currentMessages,
				tools,
				config,
				callbacks,
				logger
			);

			// Handle different response types
			if (response.type === 'complete') {
				// Natural completion - return result
				logger.info('Operation completed naturally', { iterations: iteration });
				return { string: response.content };
			}

			if (response.type === 'tool_calls') {
				// Execute tool calls and continue loop
				const toolResults = await this.executeToolCalls(
					response.toolCalls,
					tools,
					callbacks,
					logger
				);

				// Add tool results to conversation
				currentMessages = [
					...currentMessages,
					{
						role: 'assistant',
						content: response.content,
						tool_calls: response.toolCalls.map(tc => ({
							id: tc.id,
							type: 'function',
							function: {
								name: tc.name,
								arguments: JSON.stringify(tc.parameters),
							},
						})),
					},
					...toolResults.map((result, idx) => ({
						role: 'tool' as const,
						tool_call_id: response.toolCalls[idx].id,
						content: typeof result === 'string' ? result : JSON.stringify(result),
					})),
				];

				iteration++;
				continue;
			}

			if (response.type === 'error') {
				throw new Error(`Inference error: ${response.error}`);
			}

			// Unknown response type
			throw new Error(`Unknown response type: ${(response as {type: string}).type}`);
		}

		throw new Error(`Max tool iterations (${this.MAX_TOOL_ITERATIONS}) exceeded`);
	}

	/**
	 * Stream inference with real-time updates
	 */
	private async streamInference(
		env: Env,
		inferenceContext: IInferenceContext,
		messages: Message[],
		tools: ToolDefinition<unknown, unknown>[],
		config: AgentConfig,
		callbacks: ToolCallbacks,
		logger: Logger
	): Promise<StreamResponse> {
		const { streamCb } = callbacks;

		// Build tool schemas for LLM
		const toolSchemas = tools.map(t => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			},
		}));

		let accumulatedContent = '';
		let toolCalls: ToolCall[] = [];
		let isComplete = false;

		try {
			// Start streaming inference
			const stream = await inferStream({
				env,
				inferenceContext,
				messages,
				tools: toolSchemas,
				tool_choice: 'auto',
				stream: true,
			});

			// Process stream chunks
			for await (const chunk of stream) {
				// Handle content chunks
				if (chunk.type === 'content') {
					accumulatedContent += chunk.content;
					streamCb?.(chunk.content);
				}

				// Handle tool call chunks
				if (chunk.type === 'tool_call') {
					toolCalls = this.parseToolCalls(chunk.tool_calls || []);
				}

				// Check for completion signal
				if (chunk.type === 'complete') {
					isComplete = true;
				}
			}

			// Determine response type
			if (toolCalls.length > 0) {
				return {
					type: 'tool_calls',
					content: accumulatedContent,
					toolCalls,
				};
			}

			if (isComplete || accumulatedContent.includes(config.completionSignalName)) {
				return {
					type: 'complete',
					content: accumulatedContent,
				};
			}

			// Default to complete if no tools and content exists
			return {
				type: 'complete',
				content: accumulatedContent,
			};

		} catch (error) {
			logger.error('Streaming inference failed', error);
			return {
				type: 'error',
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	/**
	 * Parse tool calls from LLM response
	 */
	private parseToolCalls(rawToolCalls: unknown[]): ToolCall[] {
		return rawToolCalls.map((tc: unknown) => {
			const toolCall = tc as {
				id: string;
				function: {
					name: string;
					arguments: string;
				};
			};

			return {
				id: toolCall.id,
				name: toolCall.function.name,
				parameters: JSON.parse(toolCall.function.arguments),
			};
		});
	}

	/**
	 * Execute tool calls and return results
	 */
	private async executeToolCalls(
		toolCalls: ToolCall[],
		availableTools: ToolDefinition<unknown, unknown>[],
		callbacks: ToolCallbacks,
		logger: Logger
	): Promise<unknown[]> {
		const results: unknown[] = [];

		for (const toolCall of toolCalls) {
			const tool = availableTools.find(t => t.name === toolCall.name);

			if (!tool) {
				logger.warn(`Tool not found: ${toolCall.name}`);
				results.push({ error: `Tool not found: ${toolCall.name}` });
				continue;
			}

			try {
				logger.info(`Executing tool: ${toolCall.name}`);

				// Render tool call in UI
				callbacks.toolRenderer({
					name: toolCall.name,
					status: 'running',
					args: toolCall.parameters,
				});

				// Execute tool
				const result = await tool.execute(toolCall.parameters);

				// Render completion
				callbacks.toolRenderer({
					name: toolCall.name,
					status: 'success',
					args: toolCall.parameters,
					result: result,
				});

				// Notify completion
				if (callbacks.onToolComplete) {
					await callbacks.onToolComplete({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id,
					});
				}

				results.push(result);

			} catch (error) {
				logger.error(`Tool execution failed: ${toolCall.name}`, error);

				callbacks.toolRenderer({
					name: toolCall.name,
					status: 'error',
					args: toolCall.parameters,
					error: error instanceof Error ? error.message : 'Unknown error',
				});

				results.push({
					error: error instanceof Error ? error.message : 'Tool execution failed'
				});
			}
		}

		return results;
	}
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Agent configuration
 */
interface AgentConfig {
	/** Action name for analytics */
	agentActionName: string;

	/** Tool name that signals completion */
	completionSignalName: string;

	/** Operational mode */
	operationalMode: 'initial' | 'followup';

	/** Whether to inject warnings */
	allowWarningInjection: boolean;
}

/**
 * Response from streaming inference
 */
type StreamResponse =
	| { type: 'complete'; content: string }
	| { type: 'tool_calls'; content: string; toolCalls: ToolCall[] }
	| { type: 'error'; error: string };

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a simple operation that doesn't use tools
 */
export function createSimpleOperation<
	Inputs,
	Outputs
>(
	executeFn: (inputs: Inputs, options: OperationOptions) => Promise<Outputs>
): AgentOperation<Inputs, Outputs> {
	return new (class extends AgentOperation<Inputs, Outputs> {
		protected buildSession(): unknown {
			return {};
		}

		protected async executeCore(
			inputs: Inputs,
			options: OperationOptions
		): Promise<Outputs> {
			return executeFn(inputs, options);
		}
	})();
}

/**
 * Retry wrapper for operations with exponential backoff
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	options: {
		maxRetries?: number;
		baseDelay?: number;
		maxDelay?: number;
		retryableErrors?: string[];
	} = {}
): Promise<T> {
	const {
		maxRetries = 3,
		baseDelay = 1000,
		maxDelay = 30000,
		retryableErrors = ['rate_limit', 'timeout', 'network_error'],
	} = options;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Check if error is retryable
			const isRetryable = retryableErrors.some(e =>
				lastError!.message.toLowerCase().includes(e)
			);

			if (!isRetryable || attempt === maxRetries - 1) {
				throw lastError;
			}

			// Calculate delay with exponential backoff
			const delay = Math.min(
				baseDelay * Math.pow(2, attempt),
				maxDelay
			);

			// Add jitter
			const jitter = Math.random() * 1000;
			await new Promise(r => setTimeout(r, delay + jitter));
		}
	}

	throw lastError!;
}
