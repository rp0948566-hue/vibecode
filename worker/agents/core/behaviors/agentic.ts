/**
 * base.ts
 *
 * Base class for all coding behaviors in VibeSDK.
 *
 * This abstract class defines the contract and shared functionality for:
 * - AgenticCodingBehavior (autonomous multi-agent swarm)
 * - PhasicCodingBehavior (structured phase-based generation)
 * - SimpleCodingBehavior (direct single-pass generation)
 *
 * It handles:
 * - State management and persistence
 * - Infrastructure services (file manager, inference, deployment)
 * - WebSocket communication
 * - User input queuing
 * - Common utility methods
 */

import {
	AgentInitArgs,
	AgentState,
	GenerationStatus,
	WebSocketMessageType
} from '../types';
import { IStateManager } from '../../services/interfaces/IStateManager';
import { IFileManager } from '../../services/interfaces/IFileManager';
import { IDeploymentManager } from '../../services/interfaces/IDeploymentManager';
import { ICodingAgent, AgentMode, AgentPhase } from '../../services/interfaces/ICodingAgent';
import { IInferenceContext, InferenceContext } from '../../inferutils/config';
import { Emitter } from '../../../services/emitter';
import { Logger } from '../../../logger';
import { TemplateDetails } from '../../utils/templates';
import { ProcessedImageAttachment } from '../../../types/image-attachment';
import { SandboxService } from '../../../services/sandbox/BaseSandboxService';
import { DeploymentManager } from '../../../services/deployer/deployer';
import { WebSocketMessageResponses } from '../../constants';
import { IdGenerator } from '../../utils/idGenerator';
import { FileRegenerationOperation } from '../../operations/FileRegeneration';
import { FastCodeFixerOperation } from '../../operations/PostPhaseCodeFixer';
import { UserConversationProcessor } from '../../operations/UserConversationProcessor';
import { SimpleCodeGenerationOperation } from '../../operations/SimpleCodeGeneration';
import { nanoid } from 'nanoid';

/**
 * Base operations interface that all behaviors must implement
 */
export interface BaseCodingOperations {
	regenerateFile: FileRegenerationOperation;
	fastCodeFixer: FastCodeFixerOperation;
	processUserMessage: UserConversationProcessor;
	simpleGenerateFiles: SimpleCodeGenerationOperation;
}

/**
 * Abstract base class for all coding behaviors
 * Implements ICodingAgent interface and provides common functionality
 */
export abstract class BaseCodingBehavior<T extends AgentState = AgentState> implements ICodingAgent {
	// Core dependencies (injected via initialize)
	protected stateManager: IStateManager;
	protected fileManager: IFileManager;
	protected deploymentManager: IDeploymentManager;
	protected emitter: Emitter;
	protected env: Env;
	protected logger: Logger;

	// Agent identification
	protected agentId: string;
	protected projectType: 'app' | 'presentation' | 'general';

	// State
	protected state: T;
	protected infrastructure: AgentInfrastructure;

	// Generation control
	protected generationPromise: Promise<void> | null = null;
	protected abortController: AbortController | null = null;

	// User input queue for async handling during generation
	protected pendingUserInputs: string[] = [];
	protected pendingUserImages: ProcessedImageAttachment[] = [];

	// Template information
	protected templateDetails: TemplateDetails | null = null;

	constructor() {
		this.agentId = nanoid();
	}

	/**
	 * Initialize the behavior with required dependencies
	 * Must be called before any other operations
	 */
	async initialize(initArgs: AgentInitArgs<T>, ...args: unknown[]): Promise<T> {
		const {
			stateManager,
			fileManager,
			deploymentManager,
			emitter,
			env,
			logger,
			projectType = 'app',
			templateInfo
		} = initArgs;

		this.stateManager = stateManager;
		this.fileManager = fileManager;
		this.deploymentManager = deploymentManager;
		this.emitter = emitter;
		this.env = env;
		this.logger = logger.child({ agentId: this.agentId });
		this.projectType = projectType;
		this.templateDetails = templateInfo?.templateDetails || null;

		// Initialize infrastructure helper
		this.infrastructure = new AgentInfrastructure(
			this.stateManager,
			this.fileManager,
			this.emitter,
			this.logger
		);

		// Initialize or restore state
		if (initArgs.existingState) {
			this.state = initArgs.existingState;
			this.logger.info('Restored existing state', { sessionId: this.state.sessionId });
		} else {
			this.state = this.createInitialState(initArgs);
		}

		// Setup abort controller for cancellation
		this.abortController = new AbortController();

		return this.state;
	}

	/**
	 * Create initial state for new sessions
	 * Override in subclasses to provide specific state types
	 */
	protected abstract createInitialState(initArgs: AgentInitArgs<T>): T;

	/**
	 * Get the current agent ID
	 */
	getAgentId(): string {
		return this.agentId;
	}

	/**
	 * Get current state
	 */
	getState(): T {
		return this.state;
	}

	/**
	 * Update state (with optional persistence)
	 */
	protected setState(newState: T, persist: boolean = true): void {
		this.state = newState;
		if (persist) {
			this.stateManager.updateSession(newState).catch(err => {
				this.logger.error('Failed to persist state', err);
			});
		}
	}

	/**
	 * Get template details if available
	 */
	getTemplateDetails(): TemplateDetails | null {
		return this.templateDetails;
	}

	/**
	 * Get inference context for LLM operations
	 */
	getInferenceContext(): IInferenceContext {
		return new InferenceContext({
			env: this.env,
			logger: this.logger,
			metadata: this.state.metadata,
			sessionId: this.state.sessionId,
		});
	}

	/**
	 * Check if generation is currently active
	 */
	isCodeGenerating(): boolean {
		return this.generationPromise !== null;
	}

	/**
	 * Check if MVP has been generated (override in subclasses)
	 */
	protected isMVPGenerated(): boolean {
		return this.state.isMVPGenerated || false;
	}

	/**
	 * Lifecycle hook called when agent starts
	 * Override in subclasses for custom startup logic
	 */
	async onStart(props?: Record<string, unknown>): Promise<void> {
		this.logger.info('Agent starting', {
			agentId: this.agentId,
			projectType: this.projectType
		});

		// Broadcast agent ready
		this.broadcast(WebSocketMessageResponses.AGENT_READY, {
			agentId: this.agentId,
			mode: this.getAgentMode(),
			status: 'ready'
		});
	}

	/**
	 * Lifecycle hook called when agent stops
	 */
	async onStop(reason?: string): Promise<void> {
		this.logger.info('Agent stopping', { agentId: this.agentId, reason });

		// Cancel any ongoing generation
		if (this.abortController) {
			this.abortController.abort(reason || 'Agent stopped');
		}

		this.broadcast(WebSocketMessageResponses.AGENT_STOPPED, {
			agentId: this.agentId,
			reason
		});
	}

	/**
	 * Main build method - implemented by subclasses
	 */
	abstract build(): Promise<void>;

	/**
	 * Handle user input during active generation
	 * Queues messages to be processed after current generation step
	 */
	async handleUserInput(userMessage: string, images?: ProcessedImageAttachment[]): Promise<void> {
		this.pendingUserInputs.push(userMessage);

		if (images && images.length > 0) {
			this.pendingUserImages.push(...images);
		}

		this.logger.info('User input queued', {
			queueLength: this.pendingUserInputs.length,
			hasImages: !!images && images.length > 0
		});

		// If not currently generating, trigger build
		if (!this.isCodeGenerating()) {
			this.triggerBuild();
		}
	}

	/**
	 * Fetch and clear pending user requests
	 */
	protected fetchPendingUserRequests(): string[] {
		const requests = [...this.pendingUserInputs];
		this.pendingUserInputs = [];
		return requests;
	}

	/**
	 * Queue a user request for later processing
	 */
	protected async queueUserRequest(
		message: string,
		images?: ProcessedImageAttachment[]
	): Promise<void> {
		this.pendingUserInputs.push(message);
		if (images) {
			this.pendingUserImages.push(...images);
		}
	}

	/**
	 * Trigger the build process
	 */
	protected triggerBuild(): void {
		if (this.generationPromise) {
			return; // Already building
		}

		this.generationPromise = this.build()
			.then(() => {
				this.logger.info('Build completed successfully');
			})
			.catch(error => {
				this.logger.error('Build failed', error);
				this.broadcast(WebSocketMessageResponses.ERROR, {
					error: error instanceof Error ? error.message : 'Build failed'
				});
			})
			.finally(() => {
				this.generationPromise = null;
			});
	}

	/**
	 * Deploy current state to sandbox environment
	 */
	protected async deployToSandbox(): Promise<void> {
		try {
			this.broadcast(WebSocketMessageResponses.DEPLOYMENT_STARTING, {
				message: 'Deploying to preview environment...'
			});

			const deployment = await this.deploymentManager.deploy({
				sessionId: this.state.sessionId,
				projectName: this.state.projectName,
				files: this.fileManager.getAllFiles(),
				template: this.templateDetails
			});

			this.setState({
				...this.state,
				deploymentUrl: deployment.url,
				sandboxInstanceId: deployment.instanceId
			});

			this.broadcast(WebSocketMessageResponses.DEPLOYMENT_COMPLETE, {
				url: deployment.url,
				instanceId: deployment.instanceId
			});

			this.logger.info('Deployed to sandbox', {
				url: deployment.url,
				instanceId: deployment.instanceId
			});

		} catch (error) {
			this.logger.error('Deployment failed', error);
			this.broadcast(WebSocketMessageResponses.DEPLOYMENT_FAILED, {
				error: error instanceof Error ? error.message : 'Deployment failed'
			});
		}
	}

	/**
	 * Broadcast message to client via WebSocket
	 */
	protected broadcast(type: WebSocketMessageType, payload: unknown): void {
		this.emitter.emit(this.state.sessionId, {
			type,
			data: payload,
			timestamp: Date.now(),
			agentId: this.agentId
		});
	}

	/**
	 * Get the agent mode (override in subclasses)
	 */
	abstract getAgentMode(): AgentMode;

	/**
	 * Get operation options for sub-operations
	 */
	abstract getOperationOptions(): unknown;

	/**
	 * Clear abort controller after use
	 */
	protected clearAbortController(): void {
		this.abortController = null;
	}

	/**
	 * Get abort signal for cancellation support
	 */
	protected getAbortSignal(): AbortSignal | undefined {
		return this.abortController?.signal;
	}
}

/**
 * Helper class for infrastructure operations
 * Encapsulates common state and communication patterns
 */
export class AgentInfrastructure {
	constructor(
		private stateManager: IStateManager,
		private fileManager: IFileManager,
		private emitter: Emitter,
		private logger: Logger
	) {}

	/**
	 * Add message to conversation history
	 */
	addConversationMessage(message: {
		role: string;
		content: string;
		conversationId: string;
		tool_calls?: unknown[];
		tool_call_id?: string;
	}): void {
		// Persist to state manager
		this.stateManager.addConversationMessage(message).catch(err => {
			this.logger.error('Failed to add conversation message', err);
		});
	}

	/**
	 * Get current conversation state
	 */
	getConversationState(): { runningHistory: unknown[] } {
		// This would typically fetch from state manager
		return { runningHistory: [] };
	}

	/**
	 * Set conversation state
	 */
	setConversationState(state: { runningHistory: unknown[] }): void {
		// Persist to state manager
		this.stateManager.updateConversationState(state).catch(err => {
			this.logger.error('Failed to update conversation state', err);
		});
	}
}

/**
 * Type guard for checking if behavior is agentic
 */
export function isAgenticBehavior(
	behavior: BaseCodingBehavior
): behavior is BaseCodingBehavior & { executeGeneration: (attempt: number) => Promise<void> } {
	return behavior.getAgentMode() === AgentMode.AGENTIC;
}

/**
 * Type guard for checking if behavior is phasic
 */
export function isPhasicBehavior(
	behavior: BaseCodingBehavior
): behavior is BaseCodingBehavior & {
	currentPhase: AgentPhase;
	executePhase: (phase: AgentPhase) => Promise<void>
} {
	return behavior.getAgentMode() === AgentMode.PHASIC;
}
