/**
 * types.ts
 *
 * Core type definitions for the VibeSDK agent system.
 *
 * This file defines the contracts for:
 * - Agent initialization arguments
 * - Agent states (Agentic, Phasic, Simple)
 * - Generation contexts and status
 * - WebSocket message types
 * - Tool execution types
 */

import { IStateManager } from '../../services/interfaces/IStateManager';
import { IFileManager } from '../../services/interfaces/IFileManager';
import { IDeploymentManager } from '../../services/interfaces/IDeploymentManager';
import { Emitter } from '../../../services/emitter';
import { Logger } from '../../../logger';
import { IInferenceContext } from '../inferutils/config';
import { TemplateInfo } from '../utils/templates';
import { ImageAttachment, ProcessedImageAttachment } from '../../../types/image-attachment';
import { StaticAnalysisResponse } from '../../../services/sandbox/sandboxTypes';
import { PhaseConceptType } from '../schemas';

// ============================================================================
// AGENT MODES & PHASES
// ============================================================================

/**
 * Available agent operation modes
 */
export enum AgentMode {
	/** Autonomous multi-agent swarm (most advanced) */
	AGENTIC = 'agentic',

	/** Structured phase-by-phase generation */
	PHASIC = 'phasic',

	/** Direct single-pass generation (fastest) */
	SIMPLE = 'simple',
}

/**
 * Development phases for phasic mode
 */
export enum AgentPhase {
	/** Initial analysis and blueprint generation */
	ANALYSIS = 'analysis',

	/** Project setup and template initialization */
	SETUP = 'setup',

	/** Core code generation */
	IMPLEMENTATION = 'implementation',

	/** Code review and optimization */
	REVIEW = 'review',

	/** Deployment preparation */
	DEPLOYMENT = 'deployment',
}

// ============================================================================
// GENERATION STATUS
// ============================================================================

/**
 * Current status of a generation session
 */
export enum GenerationStatus {
	/** Session created but not started */
	INITIALIZING = 'initializing',

	/** Currently processing */
	PROCESSING = 'processing',

	/** Paused waiting for user input */
	WAITING = 'waiting',

	/** Successfully completed */
	COMPLETED = 'completed',

	/** Failed with error */
	FAILED = 'failed',

	/** Manually terminated */
	TERMINATED = 'terminated',
}

// ============================================================================
// AGENT STATES
// ============================================================================

/**
 * Base state interface shared by all agent types
 */
export interface AgentState {
	/** Unique session identifier */
	sessionId: string;

	/** Human-readable project name */
	projectName: string;

	/** Original user query/prompt */
	query: string;

	/** Current generation status */
	status: GenerationStatus;

	/** Template used for generation */
	templateName: string;

	/** Sandbox deployment instance ID */
	sandboxInstanceId?: string;

	/** Deployment URL if deployed */
	deploymentUrl?: string;

	/** Command history for package installation */
	commandsHistory: string[];

	/** Last known package.json content */
	lastPackageJson?: string;

	/** Hostname for the session */
	hostname: string;

	/** Metadata from inference context */
	metadata: Record<string, unknown>;

	/** Type of project being generated */
	projectType: 'app' | 'presentation' | 'general';

	/** Behavior type identifier */
	behaviorType: 'agentic' | 'phasic' | 'simple';

	/** Whether MVP has been generated */
	isMVPGenerated?: boolean;

	/** Counter for remaining phases (budget management) */
	phasesCounter: number;

	/** Pending user inputs queued during generation */
	pendingUserInputs: string[];

	/** Map of generated files */
	generatedFilesMap: Record<string, GeneratedFileInfo>;
}

/**
 * State for agentic mode (autonomous swarm)
 */
export interface AgenticState extends AgentState {
	behaviorType: 'agentic';

	/** Current project blueprint */
	blueprint: ProjectBlueprint;

	/** Whether blueprint has been generated */
	blueprintGenerated: boolean;
}

/**
 * State for phasic mode (structured phases)
 */
export interface PhasicState extends AgentState {
	behaviorType: 'phasic';

	/** Project blueprint with phases */
	blueprint: PhasicBlueprint;

	/** Currently active phase */
	currentPhase?: PhaseConceptType;

	/** All generated phases with completion status */
	generatedPhases: Array<PhaseConceptType & { completed: boolean }>;

	/** Whether review has been initiated */
	reviewingInitiated: boolean;
}

/**
 * State for simple mode (direct generation)
 */
export interface SimpleState extends AgentState {
	behaviorType: 'simple';

	/** Target files to generate */
	targetFiles: string[];
}

/**
 * Information about a generated file
 */
export interface GeneratedFileInfo {
	path: string;
	purpose: string;
	generatedAt: number;
	lastModified: number;
	size: number;
}

// ============================================================================
// BLUEPRINT TYPES
// ============================================================================

/**
 * Base project blueprint
 */
export interface ProjectBlueprint {
	/** Project title */
	title: string;

	/** Project name (slug) */
	projectName: string;

	/** Project description */
	description: string;

	/** Color palette for UI */
	colorPalette: string[];

	/** Frameworks to use */
	frameworks: string[];

	/** Generation plan */
	plan: PlanStep[];
}

/**
 * Blueprint for phasic mode with structured phases
 */
export interface PhasicBlueprint extends ProjectBlueprint {
	/** Initial phase to implement */
	initialPhase: PhaseConceptType;

	/** Estimated total phases */
	totalPhases: number;
}

/**
 * Single step in generation plan
 */
export interface PlanStep {
	/** Step description */
	description: string;

	/** Dependencies on other steps */
	dependencies?: string[];

	/** Estimated complexity (1-10) */
	complexity: number;
}

// ============================================================================
// INITIALIZATION ARGUMENTS
// ============================================================================

/**
 * Arguments for initializing any agent behavior
 */
export interface AgentInitArgs<T extends AgentState = AgentState> {
	/** User ID initiating the session */
	userId: string;

	/** Project ID */
	projectId: string;

	/** User's natural language query */
	query: string;

	/** Optional programming language preference */
	language?: string;

	/** Optional framework preferences */
	frameworks?: string[];

	/** Template information */
	templateInfo?: TemplateInfo;

	/** Sandbox session ID */
	sandboxSessionId?: string;

	/** Hostname for the session */
	hostname: string;

	/** Inference context for LLM operations */
	inferenceContext: IInferenceContext;

	/** State manager for persistence */
	stateManager: IStateManager;

	/** File manager for operations */
	fileManager: IFileManager;

	/** Deployment manager */
	deploymentManager: IDeploymentManager;

	/** Event emitter for WebSocket */
	emitter: Emitter;

	/** Environment bindings */
	env: Env;

	/** Logger instance */
	logger: Logger;

	/** Type of project */
	projectType: 'app' | 'presentation' | 'general';

	/** Existing state to restore (for reconnections) */
	existingState?: T;

	/** Mode of operation */
	mode?: AgentMode;

	/** Uploaded images */
	images?: ImageAttachment[];

	/** Callback for blueprint streaming */
	onBlueprintChunk?: (chunk: string) => void;
}

// ============================================================================
// GENERATION CONTEXT
// ============================================================================

/**
 * Context passed through generation operations
 */
export interface GenerationContext {
	/** Session identifier */
	sessionId: string;

	/** User identifier */
	userId: string;

	/** Project identifier */
	projectId: string;

	/** Current status */
	status: GenerationStatus;

	/** Operation mode */
	mode: AgentMode;

	/** Current phase */
	phase: AgentPhase;

	/** Iteration counter */
	iteration: number;

	/** Original prompt */
	prompt: string;

	/** Current blueprint */
	blueprint: ProjectBlueprint | null;

	/** File states */
	fileStates: Map<string, FileState>;

	/** Conversation history */
	conversationHistory: ConversationMessage[];

	/** Additional metadata */
	metadata: GenerationMetadata;
}

/**
 * Metadata for generation context
 */
export interface GenerationMetadata {
	/** Session start timestamp */
	startedAt: number;

	/** Model configuration */
	modelConfig?: ModelConfiguration;

	/** Selected template ID */
	templateId?: string;

	/** Custom instructions */
	customInstructions?: string;
}

/**
 * Model configuration
 */
export interface ModelConfiguration {
	provider: string;
	model: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
}

/**
 * File state tracking
 */
export interface FileState {
	path: string;
	content: string;
	version: number;
	lastModified: number;
	status: 'generating' | 'complete' | 'error';
}

/**
 * Conversation message
 */
export interface ConversationMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	conversationId: string;
	timestamp?: number;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

/**
 * Tool call from AI
 */
export interface ToolCall {
	/** Tool name */
	name: string;

	/** Call ID */
	id: string;

	/** Parameters */
	parameters: Record<string, unknown>;
}

/**
 * Result of tool execution
 */
export interface ToolResult {
	/** Whether execution succeeded */
	success: boolean;

	/** Result data */
	data?: unknown;

	/** Error message if failed */
	error?: string;

	/** Execution time in ms */
	executionTime: number;
}

// ============================================================================
// WEBSOCKET MESSAGES
// ============================================================================

/**
 * WebSocket message types
 */
export type WebSocketMessageType =
	| 'agent_ready'
	| 'generation_started'
	| 'generation_complete'
	| 'conversation_response'
	| 'blueprint'
	| 'phase'
	| 'file_generating'
	| 'file_generated'
	| 'file_chunk_generated'
	| 'phase_generating'
	| 'phase_generated'
	| 'phase_implementing'
	| 'phase_validating'
	| 'phase_validated'
	| 'phase_implemented'
	| 'deployment_starting'
	| 'deployment_complete'
	| 'deployment_failed'
	| 'error'
	| 'stream'
	| 'complete'
	| 'terminated';

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
	type: WebSocketMessageType;
	data: unknown;
	timestamp: number;
	agentId?: string;
}

/**
 * Stream chunk for real-time updates
 */
export interface StreamChunk {
	type: 'text' | 'code' | 'tool_call' | 'tool_result' | 'error';
	content: string;
	metadata?: Record<string, unknown>;
}

// ============================================================================
// EXECUTION RESULTS
// ============================================================================

/**
 * Result of phase execution
 */
export interface PhaseExecutionResult {
	/** Next state to transition to */
	currentDevState: CurrentDevState;

	/** Generated phase concept (if applicable) */
	result?: PhaseConceptType;

	/** User context for suggestions */
	userContext?: UserContext;

	/** Static analysis results */
	staticAnalysis?: StaticAnalysisResponse;
}

/**
 * Development states for phasic mode state machine
 */
export enum CurrentDevState {
	/** Idle/waiting */
	IDLE = 'IDLE',

	/** Generating next phase */
	PHASE_GENERATING = 'PHASE_GENERATING',

	/** Implementing current phase */
	PHASE_IMPLEMENTING = 'PHASE_IMPLEMENTING',

	/** Reviewing generated code */
	REVIEWING = 'REVIEWING',

	/** Finalizing generation */
	FINALIZING = 'FINALIZING',
}

/**
 * User context for suggestions
 */
export interface UserContext {
	/** User suggestions */
	suggestions: string[];

	/** Associated images */
	images?: ProcessedImageAttachment[];
}

// ============================================================================
// ISSUES & ERRORS
// ============================================================================

/**
 * Collection of all issues found
 */
export interface AllIssues {
	/** Runtime errors */
	runtimeErrors: RuntimeError[];

	/** Static analysis results */
	staticAnalysis: StaticAnalysisResponse;

	/** User-reported issues */
	userReported: UserReportedIssue[];
}

/**
 * Runtime error
 */
export interface RuntimeError {
	message: string;
	stack?: string;
	timestamp: number;
	source?: string;
}

/**
 * User-reported issue
 */
export interface UserReportedIssue {
	description: string;
	timestamp: number;
	severity: 'low' | 'medium' | 'high';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum phases allowed per session (budget protection) */
export const MAX_PHASES = 20;

/** Maximum iterations per phase */
export const MAX_ITERATIONS_PER_PHASE = 10;

/** Default model configuration */
export const DEFAULT_MODEL_CONFIG: ModelConfiguration = {
	provider: 'anthropic',
	model: 'claude-3-5-sonnet-20241022',
	temperature: 0.7,
	maxTokens: 4096,
};

/** WebSocket response type constants */
export const WebSocketMessageResponses = {
	AGENT_READY: 'agent_ready',
	GENERATION_STARTED: 'generation_started',
	GENERATION_COMPLETE: 'generation_complete',
	CONVERSATION_RESPONSE: 'conversation_response',
	BLUEPRINT: 'blueprint',
	PHASE: 'phase',
	FILE_GENERATING: 'file_generating',
	FILE_GENERATED: 'file_generated',
	FILE_CHUNK_GENERATED: 'file_chunk_generated',
	PHASE_GENERATING: 'phase_generating',
	PHASE_GENERATED: 'phase_generated',
	PHASE_IMPLEMENTING: 'phase_implementing',
	PHASE_VALIDATING: 'phase_validating',
	PHASE_VALIDATED: 'phase_validated',
	PHASE_IMPLEMENTED: 'phase_implemented',
	DEPLOYMENT_STARTING: 'deployment_starting',
	DEPLOYMENT_COMPLETE: 'deployment_complete',
	DEPLOYMENT_FAILED: 'deployment_failed',
	ERROR: 'error',
} as const;
