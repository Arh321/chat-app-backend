import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthContext } from "../middlewares/auth";

// ساخت یک نمونه OpenAPIHono با تایپ‌های کانتکست پروژه
export const createOpenAPIApp = () => {
  return new OpenAPIHono<AuthContext>();
};
