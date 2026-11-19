import type { Role } from "@ironline/shared";

/** Who is acting, and for which shop. Every service function receives one. */
export interface Ctx {
  orgId: string;
  userId: string;
  role: Role;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, "invalid", message, fields);

/** Roles allowed to change commercial data (quotes, orders, master data). */
export const EDITORS: Role[] = ["owner", "admin", "estimator", "planner"];
export const ADMINS: Role[] = ["owner", "admin"];

export function requireRole(ctx: Ctx, roles: Role[]) {
  if (!roles.includes(ctx.role)) {
    throw new HttpError(403, "forbidden", "Your role does not allow this action");
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
