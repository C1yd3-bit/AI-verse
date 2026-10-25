import { apiResponse } from "@/features/auth/guard";
import { getAuthProviderSettings } from "@/features/auth/settings";
export async function GET() {
  const settings = await getAuthProviderSettings();
  return apiResponse(
    settings
      ? { googleAvailable: settings.google, emailConfirmation: settings.emailConfirmation }
      : { googleAvailable: false, emailConfirmation: false },
    settings ? 200 : 503,
  );
}
