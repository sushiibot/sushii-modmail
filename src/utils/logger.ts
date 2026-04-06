import pino from "pino";

const logger = pino({ level: "debug" });

export function initLogger(level: string) {
  logger.level = level;
}

export function getLogger(module: string) {
  return logger.child({ module });
}

export default logger;
