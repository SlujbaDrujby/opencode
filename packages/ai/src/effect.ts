import { Decision } from "./decision.js"
import { Image } from "./image.js"
import { LLM } from "./llm.js"
import { Speech } from "./speech.js"
import { Transcription } from "./transcription.js"
import { Video } from "./video.js"

/** The Effect API: the same shape as `ai` from `@opencode/ai`, returning `Effect` and `Stream`. */
export const ai = {
  request: LLM.request,
  generate: LLM.generate,
  stream: LLM.stream,
  loop: LLM.loop,
  collect: LLM.collect,
  compact: LLM.compact,
  canCompact: LLM.canCompact,
  image: Image,
  decision: Decision,
  /** Experimental: may change without compatibility guarantees. */
  experimental: {
    speech: Speech,
    transcription: Transcription,
    video: Video,
  },
} as const

export { AIClient } from "./ai-client.js"
export { LLMClient } from "./route/client.js"
export { ImageClient } from "./image-client.js"
export { Auth } from "./route/auth.js"
export { ProviderPackage } from "./provider-package.js"
export { isContextOverflow, isContextOverflowFailure, isRetryable, isThrottleFailure } from "./provider-error.js"
export type { Interface as LLMClientShape, LLMClientService } from "./route/client.js"
export {
  ProtocolID,
  RouteID,
  ModelID,
  ProviderID,
  ResponseID,
  ContentBlockID,
  ToolCallID,
  JsonSchema,
  ProviderOptions,
  ProviderMetadata,
  HttpTimeout,
  RequestEncoding,
  HttpOptions,
  GenerationOptions,
  LanguageModelDefaults,
  ReasoningEfforts,
  ReasoningEffort,
  LanguageModelCompatibility,
  LanguageModel,
  LanguageModelSchema,
  CacheTTL,
  CacheHint,
  CachePolicyObject,
  CachePolicy,
  MessageRole,
  SystemPart,
  TextPart,
  MediaPart,
  ToolResultValue,
  ToolOutput,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
  CompactionPart,
  EffortPart,
  ContentPart,
  Message,
  Freeform,
  ToolDefinition,
  ToolNamespace,
  ToolEntry,
  ToolChoice,
  FinishReason,
  Usage,
  MediaUsage,
  CompactionResponse,
  CompactionCheckpointResponse,
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolInputError,
  ToolCall,
  ToolResult,
  FinishReasonDetails,
  StepFinish,
  Finish,
  MediaEvent,
  RawEvent,
  LLMEvent,
  LLMResponse,
  HttpContext,
  HttpRateLimitDetails,
  InvalidRequestError,
  UnsupportedOperationError,
  ProviderConfigurationError,
  AuthenticationError,
  RateLimitError,
  QuotaExceededError,
  ContentPolicyError,
  ProviderInternalError,
  TransportType,
  TransportOperation,
  TransportError,
  InvalidProviderOutputError,
  UnknownProviderError,
  TimeoutError,
  AIErrorReason,
  AIError,
} from "./schema/index.js"
export type {
  GenerationOptionsFields,
  GenerationOptionsInput,
  LanguageModelInput,
  LanguageModelProviderOptions,
  LLMRequest,
  ToolDefinitionInput,
  ToolNamespaceInput,
  ToolNamespaceEntryInput,
  ToolEntryInput,
  UsageInput,
} from "./schema/index.js"
export { ImageAspectRatio, ImageEvent, ImageModel, ImageModelSchema, ImageResponse } from "./image.js"
export type {
  ImageModelOptions,
  ImageOptions,
  ImageRequest,
  ImageRequestInput,
  ImageResolution,
  ImageRoute,
} from "./image.js"
export { DecisionClient } from "./decision-client.js"
export { DecisionRoute } from "./route/decision.js"
export { Generation } from "./generation.js"
export { ToolFailure, emptyInputJsonSchema, toDefinitions, tool } from "./tool.js"
export { ToolRuntime } from "./tool-runtime.js"
export type { ToolSettlement } from "./tool-runtime.js"
export * from "./public.js"
