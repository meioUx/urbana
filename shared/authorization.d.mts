export const moduleCatalog: { key: string; label: string; path: string }[];
export const roleModules: Record<string, string[]>;
export function canRoleAccessModule(role: string, module: string): boolean;
export function defaultModules(role: string): string[];
export function hasModuleAccess(user: any, module: string): boolean;
export function moduleForPath(path: string): string | undefined;
export function landingModule(user: any): string | undefined;
export function apiModules(path: string, method: string): string[] | null;

export const actionRoles: Record<string, string[]>;

export const MASTER_EMAIL: string;
export function isMasterUser(user: any): boolean;
export function canPerformAction(user: any, action: string): boolean;
