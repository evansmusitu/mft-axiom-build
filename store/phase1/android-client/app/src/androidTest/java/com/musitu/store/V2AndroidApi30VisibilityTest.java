package com.musitu.store;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Real Android 11 / API30 verified publisher install under package visibility.
 * Never grants QUERY_ALL_PACKAGES; uses the normal source and package UI gates.
 */
@RunWith(AndroidJUnit4.class)
public final class V2AndroidApi30VisibilityTest {
  private static String sha256(byte[] bytes)throws Exception{
    StringBuilder b=new StringBuilder();
    for(byte h:MessageDigest.getInstance("SHA-256").digest(bytes))
      b.append(String.format(Locale.ROOT,"%02x",h&255));
    return b.toString();
  }
  private static void assertNotInstalled(PackageManager pm,String packageId)throws Exception{
    try {
      pm.getPackageInfo(packageId,0);
      fail("APK installed without the required OS approval");
    }catch(PackageManager.NameNotFoundException expected){}
  }
  @Test public void android11PermissionCancellationRetryAndPackageVisibility()throws Exception {
    assertEquals("isolated API30 runtime required",30,Build.VERSION.SDK_INT);
    Context context=ApplicationProvider.getApplicationContext();
    PackageManager pm=context.getPackageManager();
    UiDevice ui=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    String packageId="org.musitu.fixturealpha";
    assertNotInstalled(pm,packageId);
    assertFalse("test Store must start without install-unknown-apps approval",pm.canRequestPackageInstalls());

    V2RealApkInstrumentedTest.Signed signed=
      new V2RealApkInstrumentedTest.Signed(context,false);
    V2SignedAndroidCatalog.Release release=signed.catalog.selectAndroid("fixture-alpha");
    File apk=V2AndroidNativeInstallPolicy.stage(
      new ByteArrayInputStream(signed.archives[0].bytes),context.getFilesDir(),release);

    // Deny source authorization by backing out of Android Settings. The APK
    // must remain absent and the Store must continue to require approval.
    assertEquals(V2AndroidInstallBridge.Result.USER_APPROVAL_REQUIRED,
      V2AndroidInstallBridge.requestInstall(context,signed.catalog,"fixture-alpha",apk));
    UiObject2 sourceSwitch=ui.wait(Until.findObject(By.clazz("android.widget.Switch")),25000L);
    assertNotNull("OS source permission settings missing",sourceSwitch);
    assertFalse(sourceSwitch.isChecked());
    ui.pressBack();
    assertFalse("leaving Settings silently granted per-source approval",pm.canRequestPackageInstalls());
    assertNotInstalled(pm,packageId);

    // Explicitly authorize the Store to request APK installation.
    assertEquals(V2AndroidInstallBridge.Result.USER_APPROVAL_REQUIRED,
      V2AndroidInstallBridge.requestInstall(context,signed.catalog,"fixture-alpha",apk));
    sourceSwitch=ui.wait(Until.findObject(By.clazz("android.widget.Switch")),25000L);
    assertNotNull("Android Settings source switch missing on retry",sourceSwitch);
    sourceSwitch.click();
    long deadline=SystemClock.uptimeMillis()+20000;
    while(!pm.canRequestPackageInstalls()&&SystemClock.uptimeMillis()<deadline)SystemClock.sleep(250);
    assertTrue("user did not grant Android source approval",pm.canRequestPackageInstalls());
    ui.pressBack();

    // Cancel the first individual APK request. Source approval cannot silently
    // convert into unconditional APK installation.
    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(context,signed.catalog,"fixture-alpha",apk));
    UiObject2 install=ui.wait(Until.findObject(By.text(Pattern.compile("(?i)^install$"))),25000L);
    assertNotNull("separate APK Install button missing",install);
    ui.pressBack();
    assertNotInstalled(pm,packageId);

    // Retry a separately approved APK installation through Android UI.
    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(context,signed.catalog,"fixture-alpha",apk));
    install=ui.wait(Until.findObject(By.text(Pattern.compile("(?i)^install$"))),25000L);
    assertNotNull("APK installer missing after cancellation and retry",install);
    install.click();

    PackageInfo installed=null;
    long installedDeadline=SystemClock.uptimeMillis()+45000;
    while(SystemClock.uptimeMillis()<installedDeadline){
      try{
        installed=pm.getPackageInfo(packageId,PackageManager.GET_SIGNING_CERTIFICATES);
        break;
      }catch(PackageManager.NameNotFoundException notYetVisible){
        SystemClock.sleep(500);
      }
    }
    assertNotNull("installed signed publisher package is not visible to the Store after user consent",installed);
    assertEquals(packageId,installed.packageName);
    assertEquals(release.versionCode,installed.getLongVersionCode());
    assertNotNull(installed.signingInfo);
    android.content.pm.Signature[] signers=installed.signingInfo.getApkContentsSigners();
    assertNotNull(signers);
    assertEquals(1,signers.length);
    assertEquals("visible installed package signer differs from signed catalog",
      release.signingCertificateSha256,sha256(signers[0].toByteArray()));
  }
}
