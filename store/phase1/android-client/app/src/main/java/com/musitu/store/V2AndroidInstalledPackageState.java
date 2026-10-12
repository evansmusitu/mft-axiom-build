package com.musitu.store;

/**
 * Isolated visibility-aware installed-app inspection boundary.
 * Android 11 may hide installed apps from PackageManager, so a lookup miss
 * must NEVER be interpreted as proof the app is absent.
 */
final class V2AndroidInstalledPackageState {
  enum State {
    UNKNOWN_VISIBILITY, VERIFIED_INSTALLED, REJECTED_PACKAGE_IDENTITY,
    REJECTED_SIGNER, REJECTED_DOWNGRADE
  }
  static final class Observation {
    final String packageId,signerSha256;
    final long versionCode;
    Observation(String packageId,String signerSha256,long versionCode){
      this.packageId=packageId;
      this.signerSha256=signerSha256;
      this.versionCode=versionCode;
    }
  }
  static State assess(V2SignedAndroidCatalog.Release release,Observation installed){
    return State.UNKNOWN_VISIBILITY; // RED stub: concrete observations are not evaluated yet.
  }
  static void requireSafeInstall(V2SignedAndroidCatalog.Release release,Observation installed){
    // RED stub: must reject independently detected signer/version conflicts.
  }
  private V2AndroidInstalledPackageState(){}
}
