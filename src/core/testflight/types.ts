// shapes for the testflight publishing pipeline. the asc types mirror the
// json:api responses consumed from the app store connect api.

export interface AscCredentials {
  keyId: string;
  issuerId: string;
  // the .p8 private key contents (pkcs#8 pem)
  privateKey: string;
}

export interface TestflightBuild {
  id: string;
  // build number — CFBundleVersion
  version: string;
  // marketing version, from the pre-release version relationship
  shortVersion: string;
  processingState: string;
  expired: boolean;
  uploadedDate: string;
}

// the environment variables eas build / eas submit need, resolved from the
// app's fleet secrets. keys mirror the placeholders in the mobile eas.json.
export interface EasEnv {
  EXPO_TOKEN?: string;
  APPLE_ID?: string;
  APPLE_TEAM_ID?: string;
  ASC_APP_ID?: string;
  ASC_API_KEY_ID?: string;
  ASC_API_KEY_ISSUER_ID?: string;
}
