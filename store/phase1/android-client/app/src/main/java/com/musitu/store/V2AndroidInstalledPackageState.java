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
    if(release==null)throw new SecurityException("root-authorized signed release required");
    // A PackageManager NameNotFoundException may mean filtered visibility,
    // not that the APK is absent. Never return an "uninstalled" assertion.
    if(installed==null)return State.UNKNOWN_VISIBILITY;
    if(!release.packageId.equals(installed.packageId))
      return State.REJECTED_PACKAGE_IDENTITY;
    if(!release.signingCertificateSha256.equals(installed.signerSha256))
      return State.REJECTED_SIGNER;
    if(installed.versionCode<1)
      return State.REJECTED_PACKAGE_IDENTITY;
    if(installed.versionCode>release.versionCode)
      return State.REJECTED_DOWNGRADE;
    return State.VERIFIED_INSTALLED;
  }
  static void requireSafeInstall(V2SignedAndroidCatalog.Release release,Observation installed){
    State state=assess(release,installed);
    if(state==State.REJECTED_PACKAGE_IDENTITY||state==State.REJECTED_SIGNER||
        state==State.REJECTED_DOWNGRADE)
      throw new SecurityException("installed package conflicts with signed Android catalog: "+state);
    // UNKNOWN_VISIBILITY must still go through the normal OS installer, which
    // independently enforces signer compatibility, consent and downgrade rules.
  }
  private V2AndroidInstalledPackageState(){}
}
