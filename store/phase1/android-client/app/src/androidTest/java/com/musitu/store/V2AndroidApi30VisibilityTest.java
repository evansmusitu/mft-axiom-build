package com.musitu.store;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.security.MessageDigest;
import java.util.Locale;
import static org.junit.Assert.*;

/**
 * Separate Android 11 test sessions. The OS may terminate an instrumentation
 * process when the Store's Install-Unknown-Apps authority changes.
 *
 * The test host must exercise Android's real Settings switch and package
 * installer via UI coordinates, not appops or pm install privileges.
 */
@RunWith(AndroidJUnit4.class)
public final class V2AndroidApi30VisibilityTest {
  private static final String APP="fixture-alpha";
  private static final String PKG="org.musitu.fixturealpha";
  private static Context context(){return ApplicationProvider.getApplicationContext();}
  private static void requireApi30(){assertEquals("Android 11 required",30,Build.VERSION.SDK_INT);}
  private static void assertAbsent(PackageManager pm){
    try{pm.getPackageInfo(PKG,0);fail("publisher package unexpectedly installed");}
    catch(PackageManager.NameNotFoundException expected){}
  }
  private static V2RealApkInstrumentedTest.Signed signed()throws Exception{
    return new V2RealApkInstrumentedTest.Signed(context(),false);
  }
  private static File stage(V2RealApkInstrumentedTest.Signed f)throws Exception{
    return V2AndroidNativeInstallPolicy.stage(
      new ByteArrayInputStream(f.archives[0].bytes),context().getFilesDir(),f.catalog.selectAndroid(APP));
  }
  private static String hexSha(byte[] data)throws Exception{
    StringBuilder b=new StringBuilder();
    for(byte h:MessageDigest.getInstance("SHA-256").digest(data))
      b.append(String.format(Locale.ROOT,"%02x",h&255));
    return b.toString();
  }

  @Test public void stage01RequestSourcePermissionWithoutGranting()throws Exception{
    requireApi30();
    PackageManager pm=context().getPackageManager();
    assertFalse("fresh Android11 Store has permission before approval",pm.canRequestPackageInstalls());
    assertAbsent(pm);
    V2RealApkInstrumentedTest.Signed s=signed();
    assertEquals(V2AndroidInstallBridge.Result.USER_APPROVAL_REQUIRED,
      V2AndroidInstallBridge.requestInstall(context(),s.catalog,APP,stage(s)));
    Log.i("MUSITU_API30","STAGE01_SOURCE_SETTINGS_REQUESTED");
  }

  @Test public void stage02ConfirmDeniedPermissionCannotInstall()throws Exception{
    requireApi30();
    PackageManager pm=context().getPackageManager();
    assertFalse("leaving Settings secretly granted permission",pm.canRequestPackageInstalls());
    assertAbsent(pm);
    V2RealApkInstrumentedTest.Signed s=signed();
    assertEquals(V2AndroidInstallBridge.Result.USER_APPROVAL_REQUIRED,
      V2AndroidInstallBridge.requestInstall(context(),s.catalog,APP,stage(s)));
    Log.i("MUSITU_API30","STAGE02_SOURCE_RE_REQUESTED");
  }

  @Test public void stage03AfterSourceConsentShowsSeparateInstaller()throws Exception{
    requireApi30();
    PackageManager pm=context().getPackageManager();
    assertTrue("Android11 source permission not granted by actual Settings UI",pm.canRequestPackageInstalls());
    assertAbsent(pm);
    V2RealApkInstrumentedTest.Signed s=signed();
    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(context(),s.catalog,APP,stage(s)));
    Log.i("MUSITU_API30","STAGE03_APK_INSTALL_DIALOG_REQUESTED");
  }

  @Test public void stage04ConfirmCancelledApkAndRetry()throws Exception{
    requireApi30();
    assertTrue("approved source permission unexpectedly lost",context().getPackageManager().canRequestPackageInstalls());
    assertAbsent(context().getPackageManager());
    V2RealApkInstrumentedTest.Signed s=signed();
    File staged=stage(s);
    // The previous installer was dismissed: revoke its one-APK grant before
    // creating a fresh user-approved installation attempt.
    V2AndroidInstallBridge.revokeInstallerUriGrant(context(),staged);
    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(context(),s.catalog,APP,staged));
    Log.i("MUSITU_API30","STAGE04_APK_INSTALL_DIALOG_RETRIED");
  }

  @Test public void stage05VerifyApprovedInstalledPackageAndSigner()throws Exception{
    requireApi30();
    V2RealApkInstrumentedTest.Signed s=signed();
    V2SignedAndroidCatalog.Release release=s.catalog.selectAndroid(APP);
    PackageInfo installed=context().getPackageManager()
      .getPackageInfo(PKG,PackageManager.GET_SIGNING_CERTIFICATES);
    assertEquals(PKG,installed.packageName);
    assertEquals(release.versionCode,installed.getLongVersionCode());
    assertNotNull("signing identity absent",installed.signingInfo);
    android.content.pm.Signature[] certs=installed.signingInfo.getApkContentsSigners();
    assertNotNull(certs);
    assertEquals(1,certs.length);
    assertEquals("installed publisher signature not authorized by verified signed catalog",
      release.signingCertificateSha256,hexSha(certs[0].toByteArray()));
    V2AndroidInstallBridge.revokeInstallerUriGrant(context(),stage(s));
    Log.i("MUSITU_API30","STAGE05_INSTALLED_PACKAGE_AND_SIGNER_CONFIRMED");
  }
}
