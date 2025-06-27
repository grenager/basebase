export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

interface LogOptions {
  level?: LogLevel;
  data?: any;
}

class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel;

  private constructor() {
    // Default to INFO if LOG_LEVEL not set, or set to invalid value
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    this.currentLevel =
      LogLevel[envLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(
    level: string,
    message: string,
    options?: LogOptions
  ): string {
    const timestamp = new Date().toISOString();
    let formattedMessage = `[${timestamp}] [${level}] ${message}`;

    if (options?.data) {
      const data =
        typeof options.data === "object"
          ? JSON.stringify(options.data, null, 2)
          : options.data;
      formattedMessage += `\nData: ${data}`;
    }

    return formattedMessage;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.currentLevel;
  }

  public debug(message: string, options?: LogOptions): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage("DEBUG", message, options));
    }
  }

  public info(message: string, options?: LogOptions): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage("INFO", message, options));
    }
  }

  public warn(message: string, options?: LogOptions): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage("WARN", message, options));
    }
  }

  public error(message: string, options?: LogOptions): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage("ERROR", message, options));
    }
  }

  public graphql(
    operation: string,
    params: any,
    authorized: boolean,
    result: any
  ): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.info(`GraphQL ${operation} executed`, {
        data: {
          operation,
          params,
          authorized,
          result: this.sanitizeResult(result),
        },
      });
    }
  }

  private sanitizeResult(result: any): any {
    if (!result) return result;

    // If it's an error, just return the message
    if (result instanceof Error) {
      return { error: result.message };
    }

    // If it's a string (like JWT), check if it looks like a JWT and redact if so
    if (typeof result === "string") {
      // Simple check for JWT format (three base64 sections separated by dots)
      if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(result)) {
        return "[JWT REDACTED]";
      }
      return result;
    }

    // If it's an array, sanitize each item
    if (Array.isArray(result)) {
      return result.map((item) => this.sanitizeResult(item));
    }

    // For successful results, remove sensitive data
    const sanitized = { ...result };
    const sensitiveFields = ["password", "token", "secret", "key"];

    if (typeof sanitized === "object") {
      for (const field of sensitiveFields) {
        if (field in sanitized) {
          sanitized[field] = "[REDACTED]";
        }
      }
    }

    return sanitized;
  }
}

export const logger = Logger.getInstance();
