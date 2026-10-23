export * as ModelRetry from "./model-retry.js"

import { AIError, isRetryable } from "@opencode/ai"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"

interface Input {
  readonly cause: AIError
  readonly retry: boolean
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a call for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

// A 429 is transient, but the provider's own retry-after for it can point at the next day
// while the window actually clears within minutes. Throttled attempts get a short ladder
// instead, so a step recovers on its own. Overridable for experimentation, in seconds.
const requestedThrottleDelays = (process.env.OPENCODE_RETRY_429_DELAYS ?? "")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 0)
const THROTTLE_DELAYS = (requestedThrottleDelays.length ? requestedThrottleDelays : [20, 40, 60]).map((seconds) =>
  Duration.toMillis(Duration.seconds(seconds)),
)
const isThrottled = (cause: AIError) => cause.reason.http?.status === 429

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined
      ? undefined
      : Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
  return undefined
}

// A deployment can raise the retry budget without a rebuild when an upstream
// pool stays dead for minutes (the v1 default of 5 was too low for free-model
// providers). Bounded so a misconfiguration cannot stall a step for hours.
const requestedRetries = Number.parseInt(process.env.OPENCODE_RETRY_MAX_RETRIES ?? "", 10)
const RETRY_MAX_RETRIES = Number.isInteger(requestedRetries) && requestedRetries > 0 ? Math.min(requestedRetries, 30) : 10

// Exponential from 2s capped at 10s per gap, for 10 retries: 2, 4, 8, then 10 × 7, about 84s of
// waiting when every attempt fails (67–101s with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count.
const schedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(RETRY_MAX_RETRIES),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    const minimum = retryAfter(input)
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

// A timed-out attempt already waited minutes before failing, so the general allowance would let a
// dead provider hold a call for most of an hour. Cap those attempts well below it.
const MAX_TIMEOUT_RETRIES = 3

export const policy = Effect.gen(function* () {
  const step = yield* Schedule.toStep(schedule)
  let attempt = 1
  let timeouts = 0
  let throttles = 0
  return (input: Input) =>
    Effect.gen(function* () {
      if (isThrottled(input.cause)) {
        const delay = THROTTLE_DELAYS[throttles]
        if (delay === undefined) return undefined
        throttles++
        attempt++
        return { attempt, delay: Math.ceil(delay), retry: true }
      }
      const now = yield* Clock.currentTimeMillis
      const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
      if (!next) return undefined
      const [, duration] = next
      attempt++
      if (input.cause.reason._tag === "Transport" && input.cause.reason.code === "Timeout") timeouts++
      return {
        attempt,
        delay: Math.ceil(Duration.toMillis(duration)),
        retry: input.retry && timeouts <= MAX_TIMEOUT_RETRIES,
      }
    })
})

/** Retry a buffered model call from scratch; failed attempts never contribute to its returned output. */
export const retry = <A, R>(effect: Effect.Effect<A, AIError, R>) =>
  Effect.gen(function* () {
    const decide = yield* policy
    while (true) {
      const result = yield* Effect.result(effect)
      if (result._tag === "Success") return result.success
      const decision = yield* decide({ cause: result.failure, retry: isRetryable(result.failure) })
      if (!decision?.retry) return yield* result.failure
      yield* Effect.sleep(Duration.millis(decision.delay))
    }
  })
