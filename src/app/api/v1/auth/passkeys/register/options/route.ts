import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { issueWebAuthnTicket } from "@/lib/tickets";
import { webauthnService } from "@/services/webauthn.service";

export const dynamic = "force-dynamic";

/** Bước 1 — tuỳ chọn cho `navigator.credentials.create()`. */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);

    const options = await webauthnService.createRegistrationOptions(session.sub);

    return apiOk({
      options,
      challengeToken: await issueWebAuthnTicket("webauthn_reg", options.challenge, session.sub),
    });
  } catch (error) {
    return handleApiError(error, {
      route: "POST /api/v1/auth/passkeys/register/options",
      request,
    });
  }
}
