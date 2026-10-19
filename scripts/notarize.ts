import path from "node:path";

import type { AfterPackContext } from "electron-builder";

/** electron-builder afterSign hook. */
export default async function notarizeHook(context: AfterPackContext): Promise<void> {
  if (process.platform !== "darwin") return;
  // App Store Connect checks a store build itself, and notarytool rejects its signature.
  if (context.electronPlatformName === "mas") return;

  // Only run when credentials are provided (so dev builds don't block)
  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;
  const keychainProfile = process.env.APPLE_NOTARYTOOL_KEYCHAIN_PROFILE;

  if (!keychainProfile && (!appleApiKey || !appleApiKeyId || !appleApiIssuer)) {
    console.log("[notarize] Skipping (no notarization credentials set).");
    return;
  }

  // Lazy-load so local dev doesn't need the dependency.
  const { notarize } = await import("@electron/notarize");

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[notarize] Notarizing ${appPath}`);

  if (keychainProfile) {
    await notarize({ appPath, keychainProfile });
  } else if (appleApiKey && appleApiKeyId && appleApiIssuer) {
    await notarize({ appPath, appleApiKey, appleApiKeyId, appleApiIssuer });
  }

  console.log("[notarize] Done");
}
