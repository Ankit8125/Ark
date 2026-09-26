/**
 * Parse a local maintenance/test connection before constructing a database pool.
 * pg gives URL query parameters precedence over the authority's host and port,
 * so checking only URL.hostname would not establish the actual destination.
 * Callers may add their own trusted schema options after this validation.
 *
 * @param {string} connectionString
 * @param {"ark_dev" | "ark_test"} database
 * @param {string} [port]
 * @returns {URL}
 */
export function parseLocalDatabaseUrl(connectionString, database, port) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    // Never attach the parser error: it can contain credentials from the input.
    throw new Error("Local database URL is invalid; its value is withheld.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== `/${database}` ||
    (port !== undefined && url.port !== port) ||
    url.searchParams.size !== 0 ||
    url.hash !== ""
  ) {
    throw new Error(
      "Local database URL must use PostgreSQL at the approved loopback endpoint, without query parameters or fragments.",
    );
  }
  return url;
}
