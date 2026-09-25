import "server-only";
import { getPool } from "@dtn/db";

/**
 * Service-role Postgres pool for trusted server code. Callers MUST have
 * checked the user's permission for `organizationId` first (requireOrg) and
 * must pass that id to every query.
 */
export const db = () => getPool();
