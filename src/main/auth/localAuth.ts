export interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
}
let cachedUserInfo: UserInfo | null = null;
export function getCachedUserInfo(): UserInfo | null { return cachedUserInfo; }
export async function fetchUserInfo(): Promise<UserInfo | null> {
  if (!cachedUserInfo) cachedUserInfo = { id: 'anonymous', name: 'Anonymous User' };
  return cachedUserInfo;
}
export async function openSSOLoginWindow(): Promise<UserInfo | null> { return fetchUserInfo(); }
