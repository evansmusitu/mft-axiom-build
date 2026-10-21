package com.musitu.store;

import org.junit.BeforeClass;
import org.junit.Test;
import static org.junit.Assert.*;

/** Android 11 package lookups can hide applications, even when installed. */
public final class V2AndroidInstalledPackageStateTest {
  @BeforeClass public static void init()throws Exception{V2SignedAndroidCatalogTest.key();}
  private static V2SignedAndroidCatalog.Release authorized()throws Exception{
    return V2SignedAndroidCatalogTest.accept(V2SignedAndroidCatalogTest.baseline())
      .selectAndroid("musitu-chemistry");
  }
  private static V2AndroidInstalledPackageState.Observation observed(
    V2SignedAndroidCatalog.Release r,String pkg,String cert,long version){
    return new V2AndroidInstalledPackageState.Observation(pkg,cert,version);
  }
  @Test public void hiddenOrAbsentPackageIsAmbiguousNeverReportedUninstalled()throws Exception{
    assertEquals(V2AndroidInstalledPackageState.State.UNKNOWN_VISIBILITY,
      V2AndroidInstalledPackageState.assess(authorized(),null));
  }
  @Test public void visibleMatchingSignerAndVersionIsVerified()throws Exception{
    V2SignedAndroidCatalog.Release r=authorized();
    assertEquals(V2AndroidInstalledPackageState.State.VERIFIED_INSTALLED,
      V2AndroidInstalledPackageState.assess(r,observed(r,r.packageId,r.signingCertificateSha256,r.versionCode)));
  }
  @Test public void visibleDifferentSignerIsRejectedAsTakeover()throws Exception{
    V2SignedAndroidCatalog.Release r=authorized();
    V2AndroidInstalledPackageState.Observation i=observed(r,r.packageId,"f".repeat(64),r.versionCode);
    assertEquals(V2AndroidInstalledPackageState.State.REJECTED_SIGNER,
      V2AndroidInstalledPackageState.assess(r,i));
    try{V2AndroidInstalledPackageState.requireSafeInstall(r,i);fail("installed package takeover accepted");}
    catch(SecurityException expected){}
  }
  @Test public void visibleInstalledHigherVersionRejectsCatalogDowngrade()throws Exception{
    V2SignedAndroidCatalog.Release r=authorized();
    V2AndroidInstalledPackageState.Observation i=observed(r,r.packageId,r.signingCertificateSha256,r.versionCode+1);
    assertEquals(V2AndroidInstalledPackageState.State.REJECTED_DOWNGRADE,
      V2AndroidInstalledPackageState.assess(r,i));
    try{V2AndroidInstalledPackageState.requireSafeInstall(r,i);fail("downgrade accepted");}
    catch(SecurityException expected){}
  }
  @Test public void wrongPackageIdentityCannotMasqueradeAsAuthorizedPublisher()throws Exception{
    V2SignedAndroidCatalog.Release r=authorized();
    V2AndroidInstalledPackageState.Observation i=observed(r,"org.imposter.app",r.signingCertificateSha256,r.versionCode);
    assertEquals(V2AndroidInstalledPackageState.State.REJECTED_PACKAGE_IDENTITY,
      V2AndroidInstalledPackageState.assess(r,i));
    try{V2AndroidInstalledPackageState.requireSafeInstall(r,i);fail("identity mismatch accepted");}
    catch(SecurityException expected){}
  }
  @Test public void unknownVisibilityPermitsOnlyNormalOSReviewNotInstalledClaim()throws Exception{
    V2SignedAndroidCatalog.Release r=authorized();
    V2AndroidInstalledPackageState.requireSafeInstall(r,null);
    assertEquals(V2AndroidInstalledPackageState.State.UNKNOWN_VISIBILITY,
      V2AndroidInstalledPackageState.assess(r,null));
  }
  @Test public void verifiedInstalledVersionDoesNotBlockSameVersionUserReview()throws Exception{
    V2SignedAndroidCatalog.Release r=authorized();
    V2AndroidInstalledPackageState.Observation i=observed(r,r.packageId,r.signingCertificateSha256,r.versionCode);
    V2AndroidInstalledPackageState.requireSafeInstall(r,i);
  }
  @Test public void missingRootAuthorizedReleaseMustBeRejected()throws Exception{
    try{V2AndroidInstalledPackageState.assess(null,null);fail("unsigned release accepted");}
    catch(SecurityException expected){}
    try{V2AndroidInstalledPackageState.requireSafeInstall(null,null);fail("unsigned release accepted");}
    catch(SecurityException expected){}
  }
}
