/**
 * chat-input.tsx
 *
 * Main chat input component for VibeSDK.
 *
 * This is the primary user interface for vibe coding - where users describe
 * what they want to build. It supports:
 * - Natural language input with auto-resizing
 * - Image attachments (drag-drop and paste)
 * - Quick action buttons for common operations
 * - Keyboard shortcuts (Cmd+Enter to send)
 * - Loading states and disabled states during generation
 *
 * Design philosophy: Minimal, focused, empowering. The input should feel
 * like a conversation with a brilliant engineer who can build anything.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ImagePlus, Send, Loader2, Sparkles, Wand2, Code2, FileCode, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useImageUpload } from '@/hooks/use-image-upload';
import { ImageAttachmentPreview } from '@/components/image-attachment-preview';
import { ImageUploadButton } from '@/components/image-upload-button';
import { useMobile } from '@/hooks/use-mobile';

// ============================================================================
// TYPES
// ============================================================================

interface ChatInputProps {
	/** Current input value */
	value: string;

	/** Callback when input changes */
	onChange: (value: string) => void;

	/** Callback when message is submitted */
	onSubmit: (message: string, images?: File[]) => void;

	/** Whether a generation is in progress */
	isGenerating?: boolean;

	/** Placeholder text */
	placeholder?: string;

	/** Additional CSS classes */
	className?: string;

	/** Disabled state */
	disabled?: boolean;

	/** Current agent mode */
	agentMode?: 'agentic' | 'phasic' | 'simple';

	/** Suggested prompts for quick start */
	suggestedPrompts?: string[];

	/** Callback when suggested prompt is clicked */
	onSuggestedPromptClick?: (prompt: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ChatInput({
	value,
	onChange,
	onSubmit,
	isGenerating = false,
	placeholder = "Describe what you want to build...",
	className,
	disabled = false,
	agentMode = 'agentic',
	suggestedPrompts,
	onSuggestedPromptClick,
}: ChatInputProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [images, setImages] = useState<File[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const isMobile = useMobile();

	const { uploadImages, isUploading } = useImageUpload();

	// Auto-resize textarea
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	}, [value]);

	// Handle submit
	const handleSubmit = useCallback(() => {
		if (!value.trim() && images.length === 0) return;
		if (isGenerating || disabled) return;

		onSubmit(value, images.length > 0 ? images : undefined);
		setImages([]);
		onChange('');

		// Reset textarea height
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto';
		}
	}, [value, images, isGenerating, disabled, onSubmit, onChange]);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleSubmit();
		}
	}, [handleSubmit]);

	// Handle image upload
	const handleImageUpload = useCallback(async (files: FileList | null) => {
		if (!files) return;

		const imageFiles = Array.from(files).filter(file =>
			file.type.startsWith('image/')
		);

		if (imageFiles.length === 0) return;

		// Limit to 5 images
		const newImages = [...images, ...imageFiles].slice(0, 5);
		setImages(newImages);
	}, [images]);

	// Handle paste
	const handlePaste = useCallback((e: React.ClipboardEvent) => {
		const items = e.clipboardData.items;
		const imageItems: DataTransferItem[] = [];

		for (let i = 0; i < items.length; i++) {
			if (items[i].type.startsWith('image/')) {
				imageItems.push(items[i]);
			}
		}

		if (imageItems.length > 0) {
			e.preventDefault();
			const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
			handleImageUpload(files as unknown as FileList);
		}
	}, [handleImageUpload]);

	// Drag and drop handlers
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		handleImageUpload(e.dataTransfer.files);
	}, [handleImageUpload]);

	// Remove image
	const removeImage = useCallback((index: number) => {
		setImages(prev => prev.filter((_, i) => i !== index));
	}, []);

	// Get mode icon and color
	const getModeConfig = () => {
		switch (agentMode) {
			case 'agentic':
				return {
					icon: Sparkles,
					label: 'Agentic Mode',
					description: 'Autonomous multi-agent swarm',
					color: 'text-violet-500',
					bgColor: 'bg-violet-500/10',
					borderColor: 'border-violet-500/20',
				};
			case 'phasic':
				return {
					icon: Wand2,
					label: 'Phasic Mode',
					description: 'Structured phase-by-phase',
					color: 'text-blue-500',
					bgColor: 'bg-blue-500/10',
					borderColor: 'border-blue-500/20',
				};
			case 'simple':
				return {
					icon: Zap,
					label: 'Simple Mode',
					description: 'Direct single-pass',
					color: 'text-amber-500',
					bgColor: 'bg-amber-500/10',
					borderColor: 'border-amber-500/20',
				};
		}
	};

	const modeConfig = getModeConfig();
	const ModeIcon = modeConfig.icon;

	return (
		<TooltipProvider>
			<div
				className={cn(
					'relative flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-all',
					isDragging && 'border-primary ring-2 ring-primary/20',
					className
				)}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				{/* Mode indicator */}
				<div className="flex items-center gap-2">
					<div className={cn(
						'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
						modeConfig.bgColor,
						modeConfig.color
					)}>
						<ModeIcon className="h-3.5 w-3.5" />
						<span>{modeConfig.label}</span>
					</div>

					{isGenerating && (
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
							<Loader2 className="h-3 w-3 animate-spin" />
							<span>Building...</span>
						</div>
					)}
				</div>

				{/* Image attachments preview */}
				{images.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{images.map((image, index) => (
							<ImageAttachmentPreview
								key={index}
								file={image}
								onRemove={() => removeImage(index)}
								isUploading={isUploading}
							/>
						))}
					</div>
				)}

				{/* Text input */}
				<Textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					placeholder={placeholder}
					disabled={disabled || isGenerating}
					className={cn(
						'min-h-[60px] resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0',
						disabled && 'opacity-50 cursor-not-allowed'
					)}
					rows={1}
				/>

				{/* Drag overlay */}
				{isDragging && (
					<div className="absolute inset-0 flex items-center justify-center rounded-xl bg-primary/5 backdrop-blur-sm">
						<div className="flex flex-col items-center gap-2 text-primary">
							<ImagePlus className="h-8 w-8" />
							<span className="text-sm font-medium">Drop images here</span>
						</div>
					</div>
				)}

				{/* Bottom toolbar */}
				<div className="flex items-center justify-between pt-2">
					<div className="flex items-center gap-2">
						{/* Image upload button */}
						<ImageUploadButton
							onUpload={handleImageUpload}
							disabled={disabled || isGenerating || images.length >= 5}
							currentCount={images.length}
							maxCount={5}
						/>

						{/* Quick actions */}
						{!isMobile && (
							<div className="flex items-center gap-1">
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
											onClick={() => onChange(value + (value ? '\n\n' : '') + 'Add TypeScript types and error handling')}
											disabled={disabled || isGenerating}
										>
											<FileCode className="h-3.5 w-3.5" />
											Add types
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Quick add: TypeScript types</p>
									</TooltipContent>
								</Tooltip>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
											onClick={() => onChange(value + (value ? '\n\n' : '') + 'Make it responsive and accessible')}
											disabled={disabled || isGenerating}
										>
											<Code2 className="h-3.5 w-3.5" />
											Responsive
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Quick add: Responsive design</p>
									</TooltipContent>
								</Tooltip>
							</div>
						)}
					</div>

					{/* Submit button */}
					<div className="flex items-center gap-2">
						<span className="hidden text-xs text-muted-foreground md:inline">
							{isMobile ? 'Tap to send' : 'Cmd + Enter to send'}
						</span>

						<Button
							onClick={handleSubmit}
							disabled={!value.trim() && images.length === 0 || isGenerating || disabled}
							size="sm"
							className={cn(
								'h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90',
								isGenerating && 'opacity-50 cursor-not-allowed'
							)}
						>
							{isGenerating ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									<span>Building...</span>
								</>
							) : (
								<>
									<Send className="h-4 w-4" />
									<span>Send</span>
								</>
							)}
						</Button>
					</div>
				</div>

				{/* Suggested prompts */}
				{suggestedPrompts && suggestedPrompts.length > 0 && !value && !isGenerating && (
					<div className="mt-2 flex flex-wrap gap-2">
						{suggestedPrompts.map((prompt, index) => (
							<button
								key={index}
								onClick={() => onSuggestedPromptClick?.(prompt)}
								className="rounded-full border bg-secondary/50 px-3 py-1.5 text-xs text-secondary-foreground transition-colors hover:bg-secondary"
							>
								{prompt}
							</button>
						))}
					</div>
				)}
			</div>
		</TooltipProvider>
	);
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for managing chat input state
 */
export function useChatInput(
	onSubmit: (message: string, images?: File[]) => void,
	options: {
		initialValue?: string;
		suggestedPrompts?: string[];
	} = {}
) {
	const [value, setValue] = useState(options.initialValue || '');
	const [isGenerating, setIsGenerating] = useState(false);

	const handleSubmit = useCallback((message: string, images?: File[]) => {
		setIsGenerating(true);
		onSubmit(message, images);
	}, [onSubmit]);

	const handleGenerationComplete = useCallback(() => {
		setIsGenerating(false);
	}, []);

	const handleSuggestedPrompt = useCallback((prompt: string) => {
		setValue(prompt);
	}, []);

	return {
		value,
		setValue,
		isGenerating,
		handleSubmit,
		handleGenerationComplete,
		handleSuggestedPrompt,
		suggestedPrompts: options.suggestedPrompts,
	};
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatInput;
