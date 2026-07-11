import { trace } from "@opentelemetry/api";
import pino from "pino";
import { getCurrentBot } from "./botContext";

const logger = pino({
  level: "debug",
  mixin() {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const bot = getCurrentBot();

    return {
      ...(spanContext?.traceId && {
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        trace_flags: spanContext.traceFlags,
      }),
      ...(bot && { bot }),
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
