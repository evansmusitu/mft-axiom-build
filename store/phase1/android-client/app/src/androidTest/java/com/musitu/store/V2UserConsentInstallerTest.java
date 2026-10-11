package com.musitu.store;

import android.content.Context;
import android.content.pm.PackageManager;
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
import java.util.regex.Pattern;
import static org.junit.Assert.*;

/**
 * Disposable API24 emulator only. Uses the real OS installer UI, never ADB
 * package install, hidden PackageInstaller privileges or production signing keys.
 */
@RunWith(AndroidJUnit4.class)
public final class V2UserConsentInstallerTest {
  @Test public void verifiedSignedApkIsNotInstalledBeforeExplicitSystemApproval() throws Exception {
    Context context=ApplicationProvider.getApplicationContext();
    String packageId="org.musitu.fixturealpha";
    try {
      context.getPackageManager().getPackageInfo(packageId,0);
      fail("fresh test emulator already has the fixture installed");
    } catch(PackageManager.NameNotFoundException expected){}

    V2RealApkInstrumentedTest.Signed signed=
      new V2RealApkInstrumentedTest.Signed(context,false);
    V2SignedAndroidCatalog.Release selected=signed.catalog.selectAndroid("fixture-alpha");
    File staged=V2AndroidNativeInstallPolicy.stage(
      new ByteArrayInputStream(signed.archives[0].bytes),context.getFilesDir(),selected);

    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(context,signed.catalog,"fixture-alpha",staged));

    UiDevice ui=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    UiObject2 button=ui.wait(Until.findObject(By.text(Pattern.compile("(?i)^install$"))),25000);
    assertNotNull("Android must show its system installer consent control",button);

    // A signed verified APK must remain uninstalled until the visible
    // system installer approval control is activated by UIAutomator.
    try {
      context.getPackageManager().getPackageInfo(packageId,0);
      fail("package unexpectedly installed before approval");
    } catch(PackageManager.NameNotFoundException expected){}

    // UIAutomator performs an actual tap on the OS dialog; it does not
    // use ADB pm install, force-install permissions or hidden APIs.
    button.click();

    android.content.pm.PackageInfo installed=null;
    long deadline=android.os.SystemClock.uptimeMillis()+45000L;
    while(android.os.SystemClock.uptimeMillis()<deadline){
      try{
        installed=context.getPackageManager().getPackageInfo(
          packageId,PackageManager.GET_SIGNATURES);
        break;
      }catch(PackageManager.NameNotFoundException notYetInstalled){
        Thread.sleep(450L);
      }
    }
    assertNotNull("Android did not complete the user-approved APK installation",installed);
    assertEquals(packageId,installed.packageName);
    assertEquals(selected.versionCode,(long)installed.versionCode);
    assertNotNull("OS-reported certificate missing",installed.signatures);
    assertEquals(1,installed.signatures.length);
    java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
    byte[] cert=digest.digest(installed.signatures[0].toByteArray());
    StringBuilder actual=new StringBuilder();
    for(byte b:cert)actual.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
    assertEquals("installed package signing certificate differs from verified catalog",
      selected.signingCertificateSha256,actual.toString());
  }
}
