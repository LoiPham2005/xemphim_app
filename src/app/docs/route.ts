import { ApiReference } from "@scalar/nextjs-api-reference";
import { apiPath } from "@/lib/api/version";

export const dynamic = "force-dynamic";

export const GET = ApiReference({
  spec: {
    url: apiPath("/openapi.json"),
  },
  theme: "purple",
  layout: "modern",
  pageTitle: "REST API Documentation",
});
