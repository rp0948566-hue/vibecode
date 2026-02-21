/**
 * AgentCore.ts
 *
 * The central orchestration engine for VibeSDK's multi-agent AI system.
 *
 * This is the brain of the platform - it coordinates specialized AI agents,
 * manages conversation state, handles tool execution, and ensures coherent
 * multi-phase project generation.
 *
 * Architecture: Event-driven, stateful agent orchestration with WebSocket
 * streaming for real-time user feedback.
 */

import { Emitter } from '../../services/emitter';
import { IStateManager } from '../../services/interfaces/IStateManager';
import { IFileManager } from '../../services/interfaces/IFileManager';
import { IAnalysisManager } from '../../services/interfaces/IAnalysisManager';
import { ICodingAgent, AgentMode, AgentPhase } from '../../services/interfaces/ICodingAgent';
import {
	GenerationContext,
	GenerationStatus,
	AgentMessage,
	ToolCall,
	ToolResult,
	StreamChunk
} from '../types';
import { StateMigration } from './stateMigration';
import { AgenticBehavior } from './behaviors/agentic';
import { PhasicBehavior } from './behaviors/phasic';
import { BaseBehavior } from './behaviors/base';
import { objectiveStrategies } from './objectives/strategies';
import { logger } from '../../logger';
import { nanoid } from 'nanoid';

// Configuration constants for agent behavior tuning
const AGENT_CONFIG = {
	MAX_ITERATIONS: 50,           // Prevent infinite loops
	CONTEXT_WINDOW_SIZE: 128000,  // Token limit for context
	TOOL_TIMEOUT_MS: 30000,       // Tool execution timeout
	STREAM_BUFFER_MS: 50,         // Streaming buffer for smooth UX
	COMPLETION_THRESHOLD: 0.95,   // Confidence threshold for completion
} as const;

/**
 * Core agent orchestration class
 * Manages the lifecycle of AI-powered code generation sessions
 */
export class AgentCore {
	private emitter: Emitter;
	private stateManager: IStateManager;
	private fileManager: IFileManager;
	private analysisManager: IAnalysisManager;
	private stateMigration: StateMigration;

	// Active agent sessions mapped by session ID
	private activeSessions: Map<string, AgentSession> = new Map();

	// Behavior strategies for different agent modes
	private behaviors: Map<AgentMode, BaseBehavior>;

	constructor(
		emitter: Emitter,
		stateManager: IStateManager,
		fileManager: IFileManager,
		analysisManager: IAnalysisManager
	) {
		this.emitter = emitter;
		this.stateManager = stateManager;
		this.fileManager = fileManager;
		this.analysisManager = analysisManager;
		this.stateMigration = new StateMigration(stateManager);

		// Initialize behavior strategies
		this.behaviors = new Map([
			[AgentMode.AGENTIC, new AgenticBehavior(this)],
			[AgentMode.PHASIC, new PhasicBehavior(this)],
			[AgentMode.SIMPLE, new BaseBehavior(this)],
		]);

		logger.info('AgentCore initialized', {
			behaviors: Array.from(this.behaviors.keys()),
			config: AGENT_CONFIG
		});
	}

	/**
	 * Initialize a new coding session
	 * This is the entry point for all vibe coding interactions
	 */
	async initializeSession(
		userId: string,
		projectId: string,
		initialPrompt: string,
		options: SessionOptions = {}
	): Promise<AgentSession> {
		const sessionId = nanoid();
		const timestamp = Date.now();

		logger.info('Initializing new session', { sessionId, userId, projectId });

		// Create generation context with project constraints
		const context: GenerationContext = {
			sessionId,
			userId,
			projectId,
			status: GenerationStatus.INITIALIZING,
			mode: options.mode || AgentMode.AGENTIC,
			phase: AgentPhase.ANALYSIS,
			iteration: 0,
			prompt: initialPrompt,
			blueprint: null,
			fileStates: new Map(),
			conversationHistory: [],
			metadata: {
				startedAt: timestamp,
				modelConfig: options.modelConfig,
				templateId: options.templateId,
			},
		};

		// Initialize session state in database
		await this.stateManager.createSession(context);

		// Create session handler
		const session = new AgentSession(
			sessionId,
			context,
			this,
			this.emitter
		);

		this.activeSessions.set(sessionId, session);

		// Start the generation process asynchronously
		this.processSession(session).catch(error => {
			logger.error('Session processing failed', { sessionId, error });
			session.fail(error);
		});

		return session;
	}

	/**
	 * Main processing loop for a session
	 * Orchestrates the AI generation workflow
	 */
	private async processSession(session: AgentSession): Promise<void> {
		const { context } = session;
		const behavior = this.behaviors.get(context.mode);

		if (!behavior) {
			throw new Error(`Unknown agent mode: ${context.mode}`);
		}

		try {
			// Phase 1: Analysis & Blueprint Generation
			await this.runPhase(session, AgentPhase.ANALYSIS, async () => {
				context.blueprint = await behavior.generateBlueprint(context);
				await this.emitter.emit(session.id, {
					type: 'blueprint',
					data: context.blueprint
				});
			});

			// Phase 2: Project Setup & Template Selection
			await this.runPhase(session, AgentPhase.SETUP, async () => {
				await behavior.initializeProject(context);
			});

			// Phase 3: Core Implementation (iterative generation)
			await this.runPhase(session, AgentPhase.IMPLEMENTATION, async () => {
				await behavior.implementProject(context, (chunk) => {
					session.stream(chunk);
				});
			});

			// Phase 4: Review & Optimization
			await this.runPhase(session, AgentPhase.REVIEW, async () => {
				const analysis = await behavior.reviewProject(context);
				await this.handlePostReview(session, analysis);
			});

			// Phase 5: Deployment Preparation
			await this.runPhase(session, AgentPhase.DEPLOYMENT, async () => {
				await behavior.prepareDeployment(context);
			});

			// Mark as complete
			context.status = GenerationStatus.COMPLETED;
			await this.stateManager.updateSession(context);
			session.complete();

		} catch (error) {
			logger.error('Session processing error', {
				sessionId: session.id,
				phase: context.phase,
				error
			});

			context.status = GenerationStatus.FAILED;
			await this.stateManager.updateSession(context);
			throw error;
		}
	}

	/**
	 * Execute a generation phase with proper error handling and state management
	 */
	private async runPhase(
		session: AgentSession,
		phase: AgentPhase,
		phaseFn: () => Promise<void>
	): Promise<void> {
		const { context } = session;

		context.phase = phase;
		context.status = GenerationStatus.PROCESSING;
		await this.stateManager.updateSession(context);

		logger.info(`Starting phase: ${phase}`, { sessionId: session.id });

		// Emit phase start event
		await this.emitter.emit(session.id, {
			type: 'phase',
			data: { phase, status: 'started', timestamp: Date.now() }
		});

		try {
			await phaseFn();

			// Emit phase completion
			await this.emitter.emit(session.id, {
				type: 'phase',
				data: { phase, status: 'completed', timestamp: Date.now() }
			});

		} catch (error) {
			await this.emitter.emit(session.id, {
				type: 'phase',
				data: {
					phase,
					status: 'failed',
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: Date.now()
				}
			});
			throw error;
		}
	}

	/**
	 * Handle post-review actions (auto-fix or user approval)
	 */
	private async handlePostReview(
		session: AgentSession,
		analysis: ReviewAnalysis
	): Promise<void> {
		if (analysis.issues.length === 0) {
			await this.emitter.emit(session.id, {
				type: 'review',
				data: { status: 'passed', message: 'No issues found' }
			});
			return;
		}

		await this.emitter.emit(session.id, {
			type: 'review',
			data: {
				status: 'issues_found',
				issues: analysis.issues,
				suggestions: analysis.suggestions
			}
		});

		// Auto-fix if confidence is high enough
		if (analysis.autoFixConfidence > AGENT_CONFIG.COMPLETION_THRESHOLD) {
			const behavior = this.behaviors.get(session.context.mode);
			await behavior?.applyFixes(session.context, analysis.issues);
		}
	}

	/**
	 * Execute a tool call requested by the AI agent
	 * This is where AI intent becomes action
	 */
	async executeToolCall(
		sessionId: string,
		toolCall: ToolCall
	): Promise<ToolResult> {
		const session = this.activeSessions.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		const startTime = Date.now();

		try {
			logger.info('Executing tool', {
				sessionId,
				tool: toolCall.name,
				params: toolCall.parameters
			});

			// Import tools dynamically to avoid circular dependencies
			const { toolkit } = await import('../tools/toolkit');
			const tool = toolkit[toolCall.name];

			if (!tool) {
				throw new Error(`Unknown tool: ${toolCall.name}`);
			}

			// Execute with timeout protection
			const result = await Promise.race([
				tool.execute(toolCall.parameters, {
					sessionId,
					context: session.context,
					fileManager: this.fileManager,
					analysisManager: this.analysisManager,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Tool timeout')),
					AGENT_CONFIG.TOOL_TIMEOUT_MS)
				)
			]);

			const duration = Date.now() - startTime;

			// Log tool execution for analytics
			await this.analysisManager.logToolExecution({
				sessionId,
				toolName: toolCall.name,
				duration,
				success: true,
				resultSize: JSON.stringify(result).length,
			});

			return {
				success: true,
				data: result,
				executionTime: duration,
			};

		} catch (error) {
			const duration = Date.now() - startTime;

			logger.error('Tool execution failed', {
				sessionId,
				tool: toolCall.name,
				error,
				duration
			});

			await this.analysisManager.logToolExecution({
				sessionId,
				toolName: toolCall.name,
				duration,
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			});

			return {
				success: false,
				error: error instanceof Error ? error.message : 'Tool execution failed',
				executionTime: duration,
			};
		}
	}

	/**
	 * Handle user messages during an active session
	 * Supports mid-generation refinements and course corrections
	 */
	async handleUserMessage(
		sessionId: string,
		message: string
	): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		logger.info('User message received', { sessionId, messageLength: message.length });

		// Add to conversation history
		session.context.conversationHistory.push({
			role: 'user',
			content: message,
			timestamp: Date.now(),
		});

		await this.stateManager.updateSession(session.context);

		// Emit to client
		await this.emitter.emit(sessionId, {
			type: 'message',
			data: { role: 'user', content: message }
		});

		// If in implementation phase, trigger refinement
		if (session.context.phase === AgentPhase.IMPLEMENTATION) {
			const behavior = this.behaviors.get(session.context.mode);
			await behavior?.handleRefinement(session.context, message);
		}
	}

	/**
	 * Get current session status and progress
	 */
	async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
		const session = this.activeSessions.get(sessionId);
		if (session) {
			return session.getStatus();
		}

		// Check database for completed/failed sessions
		return this.stateManager.getSessionStatus(sessionId);
	}

	/**
	 * Gracefully terminate a session
	 */
	async terminateSession(sessionId: string, reason?: string): Promise<void> {
		const session = this.activeSessions.get(sessionId);

		if (session) {
			logger.info('Terminating session', { sessionId, reason });
			session.terminate(reason);
			this.activeSessions.delete(sessionId);
		}

		await this.stateManager.updateSessionStatus(
			sessionId,
			GenerationStatus.TERMINATED,
			{ terminationReason: reason }
		);
	}

	/**
	 * Recover a session from database (for reconnections)
	 */
	async recoverSession(sessionId: string): Promise<AgentSession | null> {
		const context = await this.stateManager.getSession(sessionId);
		if (!context) return null;

		const session = new AgentSession(
			sessionId,
			context,
			this,
			this.emitter
		);

		this.activeSessions.set(sessionId, session);

		// Resume processing if not complete
		if (context.status === GenerationStatus.PROCESSING) {
			this.processSession(session).catch(error => {
				logger.error('Session recovery failed', { sessionId, error });
				session.fail(error);
			});
		}

		return session;
	}

	/**
	 * Get analytics for a session
	 */
	async getSessionAnalytics(sessionId: string): Promise<SessionAnalytics> {
		return this.analysisManager.getSessionAnalytics(sessionId);
	}
}

/**
 * Individual session handler
 * Manages the lifecycle and communication for a single coding session
 */
export class AgentSession {
	public readonly id: string;
	public context: GenerationContext;
	private core: AgentCore;
	private emitter: Emitter;
	private streamController: ReadableStreamController<StreamChunk> | null = null;
	private isTerminated = false;

	constructor(
		id: string,
		context: GenerationContext,
		core: AgentCore,
		emitter: Emitter
	) {
		this.id = id;
		this.context = context;
		this.core = core;
		this.emitter = emitter;
	}

	/**
	 * Stream a chunk of data to the client
	 */
	stream(chunk: StreamChunk): void {
		if (this.isTerminated) return;

		// Buffer streaming for smooth UX
		setTimeout(() => {
			this.emitter.emit(this.id, {
				type: 'stream',
				data: chunk
			});
		}, AGENT_CONFIG.STREAM_BUFFER_MS);
	}

	/**
	 * Mark session as completed
	 */
	complete(): void {
		if (this.isTerminated) return;

		this.context.status = GenerationStatus.COMPLETED;
		this.emitter.emit(this.id, {
			type: 'complete',
			data: {
				timestamp: Date.now(),
				totalIterations: this.context.iteration
			}
		});
	}

	/**
	 * Mark session as failed
	 */
	fail(error: Error): void {
		this.context.status = GenerationStatus.FAILED;
		this.emitter.emit(this.id, {
			type: 'error',
			data: {
				message: error.message,
				stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
				timestamp: Date.now()
			}
		});
	}

	/**
	 * Terminate the session
	 */
	terminate(reason?: string): void {
		this.isTerminated = true;
		this.emitter.emit(this.id, {
			type: 'terminated',
			data: { reason, timestamp: Date.now() }
		});
	}

	/**
	 * Get current status snapshot
	 */
	getStatus(): SessionStatus {
		return {
			sessionId: this.id,
			status: this.context.status,
			phase: this.context.phase,
			mode: this.context.mode,
			iteration: this.context.iteration,
			progress: this.calculateProgress(),
			isTerminated: this.isTerminated,
		};
	}

	private calculateProgress(): number {
		const phaseWeights: Record<AgentPhase, number> = {
			[AgentPhase.ANALYSIS]: 0.1,
			[AgentPhase.SETUP]: 0.2,
			[AgentPhase.IMPLEMENTATION]: 0.5,
			[AgentPhase.REVIEW]: 0.1,
			[AgentPhase.DEPLOYMENT]: 0.1,
		};

		const phases = Object.values(AgentPhase);
		const currentPhaseIndex = phases.indexOf(this.context.phase);
		const completedPhaseWeight = phases
			.slice(0, currentPhaseIndex)
			.reduce((sum, phase) => sum + phaseWeights[phase], 0);

		return Math.min(0.99, completedPhaseWeight);
	}
}

// Type definitions
interface SessionOptions {
	mode?: AgentMode;
	modelConfig?: ModelConfiguration;
	templateId?: string;
}

interface ModelConfiguration {
	provider: string;
	model: string;
	temperature?: number;
	maxTokens?: number;
}

interface ReviewAnalysis {
	issues: Array<{
		severity: 'low' | 'medium' | 'high' | 'critical';
		file?: string;
		message: string;
		line?: number;
	}>;
	suggestions: string[];
	autoFixConfidence: number;
}

interface SessionStatus {
	sessionId: string;
	status: GenerationStatus;
	phase: AgentPhase;
	mode: AgentMode;
	iteration: number;
	progress: number;
	isTerminated: boolean;
}

interface SessionAnalytics {
	totalTokens: number;
	totalToolCalls: number;
	averageToolExecutionTime: number;
	filesGenerated: number;
	errorsEncountered: number;
	userMessages: number;
	aiResponses: number;
}

// Export singleton factory for dependency injection
export function createAgentCore(
	emitter: Emitter,
	stateManager: IStateManager,
	fileManager: IFileManager,
	analysisManager: IAnalysisManager
): AgentCore {
	return new AgentCore(emitter, stateManager, fileManager, analysisManager);
}
