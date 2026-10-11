package com.musitu.store;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.widget.Switch;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

/**
 * Real Android 8.0 (API26) OS permission and APK installation acceptance.
 * Checks the user-facing Settings permission gate before invoking the
 * normal installer UI; not a privileged or unattended install.
 */
@RunWith(AndroidJUnit4.class)
public final class V2AndroidApi26PermissionTest {
  private static String certificateSha256(byte[] bytes)throws Exception {
    byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);
    StringBuilder value=new StringBuilder();
    for(byte b:hash)value.append(String.format(Locale.ROOT,"%02x",b&255));
    return value.toString();
  }

  @Test public void android8RequiresPerSourceApprovalBeforeApprovedAPKCanInstall()throws Exception {
    assertEquals("this contract must run on Android 8.0",26,Build.VERSION.SDK_INT);
    Context context=ApplicationProvider.getApplicationContext();
    PackageManager pm=context.getPackageManager();
    final String packageId="org.musitu.fixturealpha";
    assertFalse("fresh Android 8 Store must not have per-source install permission",pm.canRequestPackageInstalls());
    try {
      pm.getPackageInfo(packageId,0);
      fail("the disposable publisher APK must not be preinstalled");
    } catch(PackageManager.NameNotFoundException expected) {}

    V2RealApkInstrumentedTest.Signed fixture=
      new V2RealApkInstrumentedTest.Signed(context,false);
    V2SignedAndroidCatalog.Release selected=fixture.catalog.selectAndroid("fixture-alpha");
    File staged=V2AndroidNativeInstallPolicy.stage(
      new ByteArrayInputStream(fixture.archives[0].bytes),context.getFilesDir(),selected);
    assertEquals(V2AndroidInstallBridge.Result.USER_APPROVAL_REQUIRED,
      V2AndroidInstallBridge.requestInstall(context,fixture.catalog,"fixture-alpha",staged));

    UiDevice ui=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    UiObject2 toggle=ui.wait(Until.findObject(By.clazz("android.widget.Switch")),25000L);
    assertNotNull("the OS must expose an explicit unknown-source permission toggle",toggle);
    assertFalse("permission must default to disabled",toggle.isChecked());
    try {
      pm.getPackageInfo(packageId,0);
      fail("no application may install before user-approved source permission");
    } catch(PackageManager.NameNotFoundException expected){}

    // The user must approve source-install authority in Android Settings.
    toggle.click();
    long approvalDeadline=SystemClock.uptimeMillis()+20000L;
    while(!pm.canRequestPackageInstalls()&&SystemClock.uptimeMillis()<approvalDeadline)
      SystemClock.sleep(250);
    assertTrue("Android did not persist user-approved Store source permission",
      pm.canRequestPackageInstalls());
    assertTrue("could not return from the OS permission Settings page",ui.pressBack());

    // Source permission is only the first gate: Android must still ask
    // separately whether to install this particular signed application.
    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(context,fixture.catalog,"fixture-alpha",staged));
    UiObject2 install=ui.wait(Until.findObject(By.text(Pattern.compile("(?i)^install$"))),25000L);
    assertNotNull("separate Android APK approval button missing after source permission",install);
    try {
      pm.getPackageInfo(packageId,0);
      fail("APK installed without separate system installation approval");
    } catch(PackageManager.NameNotFoundException expected){}

    install.click();
    PackageInfo installed=null;
    long installDeadline=SystemClock.uptimeMillis()+45000L;
    while(SystemClock.uptimeMillis()<installDeadline){
      try{
        installed=pm.getPackageInfo(packageId,PackageManager.GET_SIGNATURES);
        break;
      }catch(PackageManager.NameNotFoundException notYetInstalled){
        SystemClock.sleep(400);
      }
    }
    assertNotNull("OS never completed the approved Android 8.0 APK installation",installed);
    assertEquals(packageId,installed.packageName);
    assertEquals(selected.versionCode,(long)installed.versionCode);
    assertNotNull("installed APK signer is missing",installed.signatures);
    assertEquals(1,installed.signatures.length);
    assertEquals("the OS installed a certificate not in the signed catalog",
      selected.signingCertificateSha256,
      certificateSha256(installed.signatures[0].toByteArray()));
  }
}
