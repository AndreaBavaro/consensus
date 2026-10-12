type Level = "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, extra?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} [${scope}] ${level.toUpperCase()}: ${message}`;
  const out = extra ? `${line} ${JSON.stringify(extra)}` : line;
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export function logger(scope: string) {
  return {
    info: (message: string, extra?: Record<string, unknown>) => write("info", scope, message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => write("warn", scope, message, extra),
    error: (message: string, extra?: Record<string, unknown>) => write("error", scope, message, extra),
  };
}
