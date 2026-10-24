import { describe, expect } from "bun:test"
import { AIError, HttpContext, ProviderInternalError, QuotaExceededError, TransportError } from "@opencode/ai/effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Effect } from "effect"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })

// The refusal OpenCode's free tier sends for an exhausted public IP: a quota error advertising
// the next day, which clears within a minute once the address rotates.
const freeLimitBody =
  '{"type":"error","error":{"type":"FreeUsageLimitError","message":"Free usage limit reached. Please try again later."}}'
const freeLimit = new AIError({
  reason: new QuotaExceededError({
    message: "Free usage limit reached. Please try again later.",
    body: freeLimitBody,
    retryAfterMs: 55_458_000,
    http: new HttpContext({ url: "https://opencode.ai/zen/v1/chat/completions", status: 429, headers: {} }),
  }),
})
// The same refusal reported through a route that keeps no HTTP context.
const freeLimitWithoutHttp = new AIError({
  reason: new QuotaExceededError({ message: "FreeUsageLimitError", body: freeLimitBody }),
})
const paidQuota = new AIError({
  reason: new QuotaExceededError({
    message: "insufficient_quota",
    body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
    http: new HttpContext({ url: "https://api.openai.com/v1/chat/completions", status: 402, headers: {} }),
  }),
})

const input = (cause: AIError) => ({
  cause,
  error: toSessionError(cause),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
  hook: () => Effect.void,
  retry: SessionRunnerRetry.isRetryable(cause),
})

// Decisions for `count` consecutive failures of the same cause within one step.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: boolean[] = []
    for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
    return results
  })

const ladder = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: Array<{ retry: boolean; delay?: number }> = []
    for (let i = 0; i < count; i++) {
      const decision = yield* policy(input(cause))
      results.push(decision.retry ? { retry: true, delay: decision.delay } : { retry: false })
    }
    return results
  })

describe("SessionRunnerRetry.policy", () => {
  it.effect("stops retrying transport timeouts after three attempts", () =>
    Effect.gen(function* () {
      expect(yield* decisions(timeout, 4)).toEqual([true, true, true, false])
    }),
  )

  it.effect("keeps the general allowance for other transient failures", () =>
    Effect.gen(function* () {
      expect(yield* decisions(internal, 11)).toEqual([...Array(10).fill(true), false])
    }),
  )

  it.effect("waits out a free-tier throttle instead of the provider's next-day retry-after", () =>
    Effect.gen(function* () {
      const attempts = yield* ladder(freeLimit, 9)
      expect(attempts.filter((attempt) => attempt.retry)).toHaveLength(8)
      expect(attempts.at(-1)).toEqual({ retry: false })
      // Bounded far below the advertised retry-after, so a step cannot stall for hours.
      expect(attempts.every((attempt) => (attempt.delay ?? 0) < 300_000)).toBe(true)
      expect(attempts[0]).toEqual({ retry: true, delay: 20_000 })
    }),
  )

  it.effect("throttles a free-tier refusal that carries no HTTP context", () =>
    Effect.gen(function* () {
      expect(yield* decisions(freeLimitWithoutHttp, 2)).toEqual([true, true])
    }),
  )

  it.effect("does not retry an account quota that another request cannot fix", () =>
    Effect.gen(function* () {
      expect(yield* decisions(paidQuota, 2)).toEqual([false, false])
    }),
  )
})
