import { runnerOptions, runRunner } from "./client.js";
import { readEnrollmentCode } from "./input.js";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const options = runnerOptions(process.argv.slice(2));
  if (options.help)
    console.log(
      "Local heartbeat runner: pnpm.cmd runner:local [--api http://127.0.0.1:3001] [--origin http://127.0.0.1:3001]\nEnter the enrollment code at the hidden prompt or pipe it through stdin. Credentials stay in memory; restart requires new enrollment. No jobs or commands execute.",
    );
  else {
    const enrollmentToken = await readEnrollmentCode(
      process.stdin,
      process.stderr,
      controller.signal,
    );
    await runRunner({
      ...options,
      enrollmentToken,
      signal: controller.signal,
      onStatus: (message) => console.log(message),
    });
  }
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") controller.abort();
  if (!controller.signal.aborted) {
    // All public messages are generated locally; raw network/parser errors and
    // credentials must never reach terminal output.
    const safe =
      error instanceof Error &&
      (error.message.startsWith("Use ") ||
        error.message.startsWith("Enrollment code") ||
        error.message.startsWith("Runner authentication") ||
        error.message.startsWith("Connection did not recover"))
        ? error.message
        : "The foreground runner could not continue. Check the local API and enrollment, then try again.";
    console.error(safe);
    process.exitCode = 1;
  }
} finally {
  controller.abort();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
