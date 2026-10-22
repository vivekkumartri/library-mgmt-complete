import { Capacitor } from '@capacitor/core';
import { NativeBiometric, AccessControl } from '@capgo/capacitor-native-biometric';

// Namespacing key for the stored credential — not a real server name,
// just the "service" bucket the plugin's secure storage groups entries
// under (same idea as a Keychain service identifier).
const SERVER_KEY = 'com.pilaan.librarymgmt.refresh';

/** True only inside the native Android/iOS shell — biometrics never apply to the web app. */
export function biometricsSupported() {
  return Capacitor.isNativePlatform();
}

export async function isBiometricAvailable() {
  if (!biometricsSupported()) return false;
  try {
    const result = await NativeBiometric.isAvailable();
    return result.isAvailable;
  } catch {
    return false;
  }
}

export async function hasStoredBiometricLogin() {
  if (!biometricsSupported()) return false;
  try {
    const { isSaved } = await NativeBiometric.isCredentialsSaved({ server: SERVER_KEY });
    return isSaved;
  } catch {
    return false;
  }
}

/**
 * Stores the refresh token behind the device's biometric/passcode gate.
 * `username` is the logged-in user's own id (admin email or student id) —
 * not used for anything server-side, just carried alongside the token so
 * the unlock screen can show "Continue as <id>" without a round trip.
 */
export async function enableBiometricLogin({ username, refreshToken }) {
  await NativeBiometric.setCredentials({
    server: SERVER_KEY,
    username,
    password: refreshToken,
    accessControl: AccessControl.BIOMETRY_ANY,
  });
}

export async function disableBiometricLogin() {
  try {
    await NativeBiometric.deleteCredentials({ server: SERVER_KEY });
  } catch {
    // Nothing stored — fine, this is also called defensively on logout.
  }
}

/**
 * Prompts Face ID / fingerprint / device passcode, then returns the
 * stored { username, refreshToken }. Throws if the user cancels, fails
 * the prompt, or nothing was ever stored (caller should fall back to the
 * password form either way).
 */
export async function unlockWithBiometrics() {
  await NativeBiometric.verifyIdentity({
    title: 'Unlock Library Management',
    subtitle: 'Use your fingerprint or face to continue',
  });
  const creds = await NativeBiometric.getCredentials({ server: SERVER_KEY });
  return { username: creds.username, refreshToken: creds.password };
}
