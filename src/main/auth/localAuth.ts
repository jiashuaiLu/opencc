/**
 * OpenCC 本地认证模块（开源版）
 * 开源版不强制登录，返回匿名用户信息
 */

export interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
  erp?: string;
  organizationName?: string;
}

let cachedUserInfo: UserInfo | null = null;

export function getCachedUserInfo(): UserInfo | null {
  return cachedUserInfo;
}

export async function fetchUserInfo(): Promise<UserInfo | null> {
  if (!cachedUserInfo) {
    cachedUserInfo = {
      id: 'anonymous',
      name: 'Anonymous User',
    };
  }
  return cachedUserInfo;
}

export async function openSSOLoginWindow(): Promise<UserInfo | null> {
  return fetchUserInfo();
}

export async function logout(): Promise<void> {
  cachedUserInfo = null;
}
