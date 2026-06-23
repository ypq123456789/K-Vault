import * as rootMiddleware from "../functions/_middleware.js";
import * as uploadRoute from "../functions/upload.js";
import * as fileMiddleware from "../functions/file/_middleware.js";
import * as fileRoute from "../functions/file/[id].js";
import * as shareRoute from "../functions/s/[slug].js";
import * as apiMiddleware from "../functions/api/_middleware.js";
import * as apiHealthRoute from "../functions/api/health.js";
import * as apiStatusRoute from "../functions/api/status.js";
import * as apiUiConfigRoute from "../functions/api/ui-config.js";
import * as apiUploadFromUrlRoute from "../functions/api/upload-from-url.js";
import * as apiAdminMiddleware from "../functions/api/admin/_middleware.js";
import * as apiAdminTokensRoute from "../functions/api/admin/tokens.js";
import * as apiAdminTokenRoute from "../functions/api/admin/tokens/[id].js";
import * as apiAdminMigrateR2D1Route from "../functions/api/admin/migrate_r2_d1.js";
import * as apiMigrateRoute from "../functions/api/migrate.js";
import * as apiAuthCheckRoute from "../functions/api/auth/check.js";
import * as apiAuthLoginRoute from "../functions/api/auth/login.js";
import * as apiAuthLogoutRoute from "../functions/api/auth/logout.js";
import * as apiBingWallpaperRoute from "../functions/api/bing/wallpaper/index.js";
import * as apiChunkedUploadChunkRoute from "../functions/api/chunked-upload/chunk.js";
import * as apiChunkedUploadCompleteRoute from "../functions/api/chunked-upload/complete.js";
import * as apiChunkedUploadInitRoute from "../functions/api/chunked-upload/init.js";
import * as apiFileInfoRoute from "../functions/api/file-info/[id].js";
import * as apiManageMiddleware from "../functions/api/manage/_middleware.js";
import * as apiManageBlockRoute from "../functions/api/manage/block/[id].js";
import * as apiManageCheckRoute from "../functions/api/manage/check.js";
import * as apiManageDeleteRoute from "../functions/api/manage/delete/[id].js";
import * as apiManageEditNameRoute from "../functions/api/manage/editName/[id].js";
import * as apiManageFilesMoveFolderRoute from "../functions/api/manage/files/move-folder.js";
import * as apiManageFoldersRoute from "../functions/api/manage/folders.js";
import * as apiManageListRoute from "../functions/api/manage/list.js";
import * as apiManageLoginRoute from "../functions/api/manage/login.js";
import * as apiManageLogoutRoute from "../functions/api/manage/logout.js";
import * as apiManageToggleLikeRoute from "../functions/api/manage/toggleLike/[id].js";
import * as apiManageWhiteRoute from "../functions/api/manage/white/[id].js";
import * as apiR2UploadRoute from "../functions/api/r2/upload.js";
import * as apiTelegramWebhookRoute from "../functions/api/telegram/webhook.js";
import * as apiV1Middleware from "../functions/api/v1/_middleware.js";
import * as apiV1FileRoute from "../functions/api/v1/file/[id].js";
import * as apiV1FileInfoRoute from "../functions/api/v1/file/[id]/info.js";
import * as apiV1FilesRoute from "../functions/api/v1/files.js";
import * as apiV1PasteRoute from "../functions/api/v1/paste.js";
import * as apiV1PasteIdRoute from "../functions/api/v1/paste/[id].js";
import * as apiV1PastesRoute from "../functions/api/v1/pastes.js";
import * as apiV1UploadRoute from "../functions/api/v1/upload.js";

const routes = [
  route("/upload", uploadRoute),
  route("/file/:id", fileRoute, [fileMiddleware]),
  route("/s/:slug", shareRoute),
  route("/api/health", apiHealthRoute, [apiMiddleware]),
  route("/api/status", apiStatusRoute, [apiMiddleware]),
  route("/api/ui-config", apiUiConfigRoute, [apiMiddleware]),
  route("/api/upload-from-url", apiUploadFromUrlRoute, [apiMiddleware]),
  route("/api/admin/tokens", apiAdminTokensRoute, [apiMiddleware, apiAdminMiddleware]),
  route("/api/admin/tokens/:id", apiAdminTokenRoute, [apiMiddleware, apiAdminMiddleware]),
  route("/api/admin/migrate_r2_d1", apiAdminMigrateR2D1Route, [apiMiddleware, apiAdminMiddleware]),
  route("/api/migrate", apiMigrateRoute, [apiMiddleware]),
  route("/api/auth/check", apiAuthCheckRoute, [apiMiddleware]),
  route("/api/auth/login", apiAuthLoginRoute, [apiMiddleware]),
  route("/api/auth/logout", apiAuthLogoutRoute, [apiMiddleware]),
  route("/api/bing/wallpaper", apiBingWallpaperRoute, [apiMiddleware]),
  route("/api/chunked-upload/chunk", apiChunkedUploadChunkRoute, [apiMiddleware]),
  route("/api/chunked-upload/complete", apiChunkedUploadCompleteRoute, [apiMiddleware]),
  route("/api/chunked-upload/init", apiChunkedUploadInitRoute, [apiMiddleware]),
  route("/api/file-info/:id", apiFileInfoRoute, [apiMiddleware]),
  route("/api/manage/block/:id", apiManageBlockRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/check", apiManageCheckRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/delete/:id", apiManageDeleteRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/editName/:id", apiManageEditNameRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/files/move-folder", apiManageFilesMoveFolderRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/folders", apiManageFoldersRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/list", apiManageListRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/login", apiManageLoginRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/logout", apiManageLogoutRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/toggleLike/:id", apiManageToggleLikeRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/manage/white/:id", apiManageWhiteRoute, [apiMiddleware, apiManageMiddleware]),
  route("/api/r2/upload", apiR2UploadRoute, [apiMiddleware]),
  route("/api/telegram/webhook", apiTelegramWebhookRoute, [apiMiddleware]),
  route("/api/v1/file/:id/info", apiV1FileInfoRoute, [apiMiddleware, apiV1Middleware]),
  route("/api/v1/file/:id", apiV1FileRoute, [apiMiddleware, apiV1Middleware]),
  route("/api/v1/files", apiV1FilesRoute, [apiMiddleware, apiV1Middleware]),
  route("/api/v1/paste/:id", apiV1PasteIdRoute, [apiMiddleware, apiV1Middleware]),
  route("/api/v1/paste", apiV1PasteRoute, [apiMiddleware, apiV1Middleware]),
  route("/api/v1/pastes", apiV1PastesRoute, [apiMiddleware, apiV1Middleware]),
  route("/api/v1/upload", apiV1UploadRoute, [apiMiddleware, apiV1Middleware]),
];

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    const matched = routes.find((candidate) => candidate.pattern.test(url.pathname));
    const params = matched ? extractParams(matched, url.pathname) : {};
    const handler = matched ? dispatchModule(matched.module) : serveAssets;

    return runMiddlewareChain({
      request,
      env,
      params,
      data: {},
      executionContext,
      waitUntil: executionContext.waitUntil.bind(executionContext),
      passThroughOnException: executionContext.passThroughOnException?.bind(executionContext),
    }, [
      ...normalizeHandlers(rootMiddleware),
      ...(matched?.middlewares || []).flatMap(normalizeHandlers),
      handler,
    ]);
  },
};

function route(pattern, module, middlewares = []) {
  return {
    pattern,
    module,
    middlewares,
    ...compilePattern(pattern),
  };
}

function compilePattern(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return "/([^/]+)";
    });
  return {
    keys,
    pattern: new RegExp(`^${source}/?$`),
  };
}

function extractParams(routeConfig, pathname) {
  const match = routeConfig.pattern.exec(pathname);
  return Object.fromEntries(routeConfig.keys.map((key, index) => [
    key,
    decodeURIComponent(match[index + 1] || ""),
  ]));
}

function normalizeHandlers(module) {
  const handlers = module.onRequest || [];
  return Array.isArray(handlers) ? handlers : [handlers];
}

function dispatchModule(module) {
  return (context) => {
    const methodName = `onRequest${toPascalCase(context.request.method)}`;
    const handler = module[methodName]
      || (context.request.method === "HEAD" ? module.onRequestGet : null)
      || module.onRequest;
    if (!handler) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: allowedMethods(module).join(", ") },
      });
    }
    return handler(context);
  };
}

function toPascalCase(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function allowedMethods(module) {
  const methods = Object.keys(module)
    .map((key) => /^onRequest([A-Z][a-z]+)$/.exec(key)?.[1]?.toUpperCase())
    .filter(Boolean);
  return methods.length ? methods : ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
}

async function runMiddlewareChain(baseContext, handlers) {
  let index = -1;

  async function next() {
    index += 1;
    const handler = handlers[index];
    if (!handler) return serveAssets(baseContext);
    return handler({
      ...baseContext,
      next,
    });
  }

  return next();
}

function serveAssets(context) {
  if (!context.env.ASSETS) {
    return new Response("Not Found", { status: 404 });
  }
  return context.env.ASSETS.fetch(context.request);
}
