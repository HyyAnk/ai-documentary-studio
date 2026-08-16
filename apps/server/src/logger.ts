import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type LogLevel = "INFO" | "STEP" | "OK" | "WARN" | "ERROR" | "DEBUG";
type LogContext = {
  profileId?: string;
  profileName?: string;
  wallet?: string;
  workerId?: string;
  step?: string;
};

const colors: Record<LogLevel, string> = {
  INFO: "\u001b[36m",
  STEP: "\u001b[1;34m",
  OK: "\u001b[32m",
  WARN: "\u001b[33m",
  ERROR: "\u001b[1;31m",
  DEBUG: "\u001b[2m",
};
const reset = "\u001b[0m";
const profileColors = ["\u001b[36m", "\u001b[32m", "\u001b[33m", "\u001b[35m", "\u001b[34m", "\u001b[96m"];
const profileColorCache = new Map<string, string>();

function profileColor(id: string): string {
  const cached = profileColorCache.get(id);
  if (cached) return cached;
  const value = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
  const color = profileColors[value % profileColors.length] ?? profileColors[0];
  profileColorCache.set(id, color);
  return color;
}

function shortWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet;
}

export class StudioLogger {
  private logDirectory: string;
  private readonly debugEnabled: boolean;

  constructor(rootDirectory: string, debugEnabled = false) {
    this.logDirectory = path.join(rootDirectory, ".documentary-studio", "logs");
    this.debugEnabled = debugEnabled;
  }

  setRuntimeRoot(runtimeRoot: string): void {
    this.logDirectory = path.join(runtimeRoot, "logs");
  }

  async init(): Promise<void> {
    await mkdir(this.logDirectory, { recursive: true });
  }

  info(message: string, context?: LogContext): void {
    void this.write("INFO", message, context);
  }

  step(message: string, context?: LogContext): void {
    void this.write("STEP", message, context);
  }

  ok(message: string, context?: LogContext): void {
    void this.write("OK", message, context);
  }

  warn(message: string, context?: LogContext): void {
    void this.write("WARN", message, context);
  }

  error(message: string, context?: LogContext): void {
    void this.write("ERROR", message, context);
  }

  debug(message: string, context?: LogContext): void {
    if (this.debugEnabled) void this.write("DEBUG", message, context);
  }

  private async write(level: LogLevel, message: string, context: LogContext = {}): Promise<void> {
    const timestamp = new Date().toISOString();
    const contextParts = [
      context.workerId ? `[T:${context.workerId}]` : "",
      context.profileId || context.profileName
        ? `[P:${context.profileName ?? context.profileId}]`
        : "",
      context.wallet ? `[W:${shortWallet(context.wallet)}]` : "",
      context.step ? `[STEP:${context.step}]` : "",
    ].filter(Boolean);
    const plain = `[${timestamp}] [${level}] ${contextParts.join(" ")} ${message}`.replaceAll("  ", " ");
    const profileId = context.profileId ?? context.profileName;
    const coloredContext = contextParts
      .map((part) => (part.startsWith("[P:") && profileId ? `${profileColor(profileId)}${part}${reset}` : part))
      .join(" ");
    const colored = `${colors[level]}[${timestamp}] [${level}]${reset} ${coloredContext} ${message}`.replaceAll("  ", " ");
    process.stdout.write(`${colored}\n`);
    try {
      await mkdir(this.logDirectory, { recursive: true });
      const file = path.join(this.logDirectory, `${new Date().toISOString().slice(0, 10)}.log`);
      await appendFile(file, `${plain}\n`, "utf8");
    } catch {
      // Logging must not take the dashboard down if the log directory is unavailable.
    }
  }
}
