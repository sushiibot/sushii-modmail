import { trace, SpanStatusCode, type Attributes } from "@opentelemetry/api";

// trace.getTracer() returns a ProxyTracer that delegates to whatever provider
// is registered at call time, so this is safe to resolve before setupOtel() runs.
export const tracer = trace.getTracer("sushii-modmail");

/**
 * Run `fn` inside a new active span. Automatically records exceptions, sets
 * ERROR status, ends the span, then re-throws on failure.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      return await fn();
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
