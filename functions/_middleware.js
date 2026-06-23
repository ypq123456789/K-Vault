/**
 * 全局中间件
 * 只处理错误和遥测，不做认证（认证由 /api/manage/_middleware.js 处理）
 */
import { errorHandling, telemetryData } from './utils/middleware';
import { installR2MetadataStore } from './utils/r2-kv.js';
import { installD1MetadataStore } from './utils/d1-kv.js';

function metadataStore(context) {
  const env = context?.env;
  const store = String(env?.METADATA_STORE || '').trim().toLowerCase();
  if (store === 'd1' && env?.DB) {
    installD1MetadataStore(context);
  } else if (store === 'r2') {
    installR2MetadataStore(context);
  }
  return context.next();
}

export const onRequest = [metadataStore, errorHandling, telemetryData];
