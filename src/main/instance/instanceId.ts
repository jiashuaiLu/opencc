/**
 * 本地实例标识：首次启动时生成并持久化，用于本地日志与统计的唯一性区分。
 * 不依赖任何远端服务。
 */
import { randomUUID } from 'crypto';

export async function getInstanceId(database?: any): Promise<string> {
  try {
    if (database?.getSetting) {
      const saved = await database.getSetting('instance_id');
      if (saved) return saved;
    }
    const id = randomUUID();
    cached = id;
    if (database?.setSetting) {
      await database.setSetting('instance_id', id);
    }
    return id;
  } catch {
    cached = cached || randomUUID();
    return cached;
  }
}

let cached: string | null = null;

/** 同步取已缓存的实例 ID（未初始化时返回空串）。 */
export function getCachedInstanceId(): string {
  return cached || '';
}

/** 重新生成实例 ID（用于「重置本地数据」等场景）。 */
export async function resetInstanceId(database?: any): Promise<string> {
  cached = null;
  try {
    if (database?.setSetting) await database.setSetting('instance_id', '');
  } catch {
    /* 忽略 */
  }
  const id = await getInstanceId(database);
  cached = id;
  return id;
}
