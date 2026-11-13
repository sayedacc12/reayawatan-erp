export interface RoleRef { id: string; name: string }
export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  isSuperadmin: boolean;
  lastLoginAt: string | null;
  roles: RoleRef[];
}
export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
}
export interface ModuleInfo {
  code: string;
  name: string;
  description?: string;
  permissions: { code: string; name: string }[];
}
