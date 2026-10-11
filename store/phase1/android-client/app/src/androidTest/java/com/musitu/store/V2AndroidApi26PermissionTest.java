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

    // First red iteration: without the user activating Settings permission,
    // the system must refuse installation. Green implementation adds an
    // explicit toggle.click(), recheck and real Android installation.
    assertTrue("user has not yet approved this Store as an installation source",
      pm.canRequestPackageInstalls());
  }
}
