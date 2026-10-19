import type { ReadStream } from "node:tty";
import type { Writable } from "node:stream";

export function readEnrollmentCode(
  input: ReadStream,
  output: Writable,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;
    const hidden = input.isTTY;
    let changedRawMode = false;
    let done = false;
    const inputError = () =>
      new Error("Could not read the enrollment code; its value is withheld.");
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      input.off("data", data);
      input.off("end", end);
      input.off("error", fail);
      input.off("close", fail);
      signal.removeEventListener("abort", aborted);
      try {
        if (changedRawMode) input.setRawMode(wasRaw ?? false);
      } catch {
        error ??= inputError();
      }
      try {
        if (changedRawMode) output.write("\n");
      } catch {
        error ??= inputError();
      }
      input.pause();
      if (error) reject(error);
      else resolve(value.trim());
    };
    const aborted = () => {
      const error = new Error("Runner stopped.");
      error.name = "AbortError";
      finish(error);
    };
    const fail = () => finish(inputError());
    const end = () => finish();
    const data = (chunk: string | Buffer) => {
      for (const character of chunk.toString()) {
        if (done) return;
        if (character === "\u0003") {
          aborted();
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (hidden && (character === "\u007f" || character === "\b")) {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
        if (value.length > 128) {
          finish(
            new Error("Enrollment code is too long; its value is withheld."),
          );
          return;
        }
      }
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    if (input.destroyed || input.readableEnded) {
      fail();
      return;
    }
    try {
      if (hidden) {
        input.setRawMode(true);
        changedRawMode = true;
        output.write("Enrollment code (hidden): ");
      }
    } catch {
      fail();
      return;
    }
    input.on("data", data);
    input.once("end", end);
    input.once("error", fail);
    input.once("close", fail);
    signal.addEventListener("abort", aborted, { once: true });
    input.resume();
  });
}
