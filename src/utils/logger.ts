interface LogTraceOptions {
  tags?: string[];
  level?: "info" | "warn" | "error";
}

/**
 * Logs a trace event to stdout with optional tags and severity level.
 */
export function logTrace(
  message: string,
  options: LogTraceOptions = {}
): void {
  const { tags = [], level = "info" } = options;
  const timestamp = new Date().toISOString();
  const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";

  console.log(`[${timestamp}] [${level.toUpperCase()}]${tagStr} ${message}`);
}
