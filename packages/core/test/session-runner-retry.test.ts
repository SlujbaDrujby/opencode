import { describe, expect, test } from "bun:test"
import { AIError, HttpContext, ProviderInternalError, QuotaExceededError, TransportError } from "@opencode/ai/effect"
import { ModelRetry } from "@opencode/core/model-retry"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Clock, Duration, Effect } from "effect"
import { TestClock } from "effect/testing"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const dnsFailure = new AIError({
  reason: new TransportError({
    message: "getaddrinfo ENOTFOUND opencode.ai",
    transport: "http",
    operation: "request",
    code: "ENOTFOUND",
    url: "https://opencode.ai/zen/v1/responses",
  }),
})
const refused = new AIError({
  reason: new TransportError({
    message: "Unable to connect",
    transport: "http",
    operation: "request",
    code: "ECONNREFUSED",
  }),
})

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

  it.effect("keeps retrying an unreachable host for an hour with gaps of at most 30 seconds", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      const started = yield* Clock.currentTimeMillis
      const delays: number[] = []
      while (true) {
        const decision = yield* policy(input(dnsFailure))
        if (!decision.retry) break
        delays.push(decision.delay)
        yield* TestClock.adjust(Duration.millis(decision.delay))
      }
      const waited = (yield* Clock.currentTimeMillis) - started
      expect(delays.length).toBeGreaterThan(100)
      expect(Math.max(...delays)).toBeLessThanOrEqual(30_000)
      expect(waited).toBeGreaterThanOrEqual(Duration.toMillis(ModelRetry.UNREACHABLE_WINDOW))
      expect(waited).toBeLessThanOrEqual(Duration.toMillis(ModelRetry.UNREACHABLE_WINDOW) + 30_000)
    }),
  )

  it.effect("keeps a refused connection on the general allowance", () =>
    Effect.gen(function* () {
      expect(ModelRetry.isUnreachable(refused)).toBe(false)
      expect(yield* decisions(refused, 11)).toEqual([...Array(10).fill(true), false])
    }),
  )

  it.effect("doesn't spend the general allowance on an unreachable host", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      for (let i = 0; i < 20; i++) expect((yield* policy(input(dnsFailure))).retry).toBe(true)
      const results: boolean[] = []
      for (let i = 0; i < 11; i++) results.push((yield* policy(input(internal))).retry)
      expect(results).toEqual([...Array(10).fill(true), false])
    }),
  )

  // Keeps the step alive while quota-rotate moves the exit address, instead of failing after one second.
  it.effect("waits out a free-tier throttle instead of the provider's next-day retry-after", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      const attempts: Array<{ retry: boolean; delay?: number }> = []
      for (let i = 0; i < 9; i++) {
        const decision = yield* policy(input(freeLimit))
        attempts.push(decision.retry ? { retry: true, delay: decision.delay } : { retry: false })
      }
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

describe("ModelRetry.retryOneShot", () => {
  it.effect("doesn't replay a call whose response was cut off by the network going down", () =>
    Effect.gen(function* () {
      let calls = 0
      const cutOff = new AIError({
        reason: new TransportError({
          message: "Network is down",
          transport: "http",
          operation: "read",
          code: "ENETDOWN",
        }),
      })
      yield* ModelRetry.retryOneShot(Effect.suspend(() => (calls++, Effect.fail(cutOff)))).pipe(Effect.flip)
      expect(calls).toBe(1)
    }),
  )
})

describe("toSessionError", () => {
  test("names the network when the provider's host can't be reached", () => {
    expect(toSessionError(dnsFailure)).toEqual({
      type: "provider.transport",
      message: "Can't reach opencode.ai. Check the network connection. (getaddrinfo ENOTFOUND opencode.ai)",
    })
    expect(toSessionError(refused)).toEqual({ type: "provider.transport", message: "Unable to connect" })
  })
})
