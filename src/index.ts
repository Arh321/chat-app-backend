import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "dotenv/config";

import authRoutes from "./modules/auth/auth.routes";
import inviteRoutes from "./modules/invite/invite.routes";
import roomsRoutes from "./modules/rooms/rooms.routes";
import messagesRoutes from "./modules/messages/messages.routes";
import { storiesApp } from "./modules/stories/stories.routes";
import uploadApp from "./modules/upload/upload.routes";
import { profileApp } from "./modules/profile/profile.routes";
const app = new OpenAPIHono();

// Global Middlewares
app.use("*", logger());
app.use("*", cors());

// رجیستر کردن تمام ماژول‌ها
app.route("/api/profile", profileApp);
app.route("/api/auth", authRoutes);
app.route("/api/invite", inviteRoutes);
app.route("/api/rooms", roomsRoutes);
app.route("/api/messages", messagesRoutes);
app.route("/api/stories", storiesApp);
app.route("/api/upload", uploadApp);
// مستندات OpenAPI Spec
app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    title: "Chat Backend API Docs",
    version: "1.0.0",
    description: "مستندات تعاملی جامع API چت و استوری برای وب و موبایل",
  },
});

// تنظیم احراز هویت توکن Bearer در Scalar
app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// UI تست API
app.get(
  "/reference",
  apiReference({
    theme: "saturn",
    spec: {
      url: "/doc",
    },
  }),
);

// Health check
app.get("/api/health", (c) =>
  c.json({ status: "ok", time: new Date().toISOString() }),
);

const port = Number(process.env.PORT) || 3000;
console.log(`Server is running at http://localhost:${port}`);
console.log(`OpenAPI Scalar Playground: http://localhost:${port}/reference`);

serve({
  fetch: app.fetch,
  port,
});
