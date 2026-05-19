/**
 * 全局中间件
 * 只处理错误和遥测，不做认证（认证由 /api/manage/_middleware.js 处理）
 */
import { errorHandling, telemetryData } from './utils/middleware';
import { installR2MetadataStore } from './utils/r2-kv.js';

function metadataStore(context) {
  installR2MetadataStore(context);
  return context.next();
}

export const onRequest = [metadataStore, errorHandling, telemetryData];
