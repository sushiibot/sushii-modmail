import { trace } from "@opentelemetry/api";
import pino from "pino";

const logger = pino({
  level: "debug",
  mixin() {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (!spanContext?.traceId) {
      return {};
    }
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  },
});

export function initLogger(level: string) {
  logger.level = level;
}

export function getLogger(module: string) {
  return logger.child({ module });
}

export default logger;
