package com.musitu.store;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Isolated Android OS adapter for a separately verified root-signed v2 registry.
 *
 * NOT wired into the shipping v1 MainActivity. It cannot silently install.
 * OS/user approval and the existing FileProvider remain mandatory.
 */
final class V2AndroidInstallBridge {
  enum Result { SYSTEM_INSTALLER_LAUNCHED, USER_APPROVAL_REQUIRED }

  private static String hex(byte[] raw){
    StringBuilder b=new StringBuilder(raw.length*2);
    for(byte c:raw)b.append(String.format("%02x",c&255));
    return b.toString();
  }

  /** Download a selected, root-authorized release into private Store storage. */
  static File fetchAndStage(Context context,V2SignedAndroidCatalog.Verified catalog,String appId)throws Exception{
    if(context==null||catalog==null)throw new SecurityException("verified catalog and context required");
    V2SignedAndroidCatalog.Release release=catalog.selectAndroid(appId);
    HttpURLConnection http=(HttpURLConnection)new URL(release.apkUrl).openConnection();
    http.setInstanceFollowRedirects(false);
    http.setConnectTimeout(15000);
    http.setReadTimeout(60000);
    http.setRequestProperty("Accept-Encoding","identity");
    http.setRequestProperty("User-Agent","MUSITU-Store/2.0-experimental");
    try{
      int response=http.getResponseCode();
      if(response!=200)throw new SecurityException("download must have a full HTTP 200 response");
      long declared=http.getContentLengthLong();
      if(declared>release.bytes)throw new SecurityException("download response exceeds signed size");
      return V2AndroidNativeInstallPolicy.stage(http.getInputStream(),context.getFilesDir(),release);
    }finally{http.disconnect();}
  }

  private static V2AndroidNativeInstallPolicy.ArchiveInfo inspect(Context context,File apk)throws Exception{
    PackageManager pm=context.getPackageManager();
    PackageInfo info;
    if(Build.VERSION.SDK_INT>=28){
      info=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES);
      if(info==null||info.signingInfo==null)throw new SecurityException("APK signing information absent");
      android.content.pm.Signature[] signatures=info.signingInfo.getApkContentsSigners();
      if(signatures==null||signatures.length!=1)throw new SecurityException("APK must have one current signing certificate");
      String cert=hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
      return new V2AndroidNativeInstallPolicy.ArchiveInfo(info.packageName,cert,info.getLongVersionCode());
    }
    info=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNATURES);
    if(info==null||info.signatures==null||info.signatures.length!=1)
      throw new SecurityException("APK signing information absent");
    String cert=hex(MessageDigest.getInstance("SHA-256").digest(info.signatures[0].toByteArray()));
    return new V2AndroidNativeInstallPolicy.ArchiveInfo(info.packageName,cert,info.versionCode);
  }
  /**
   * The PackageManager lookup is scoped to a root-signed package identity.
   * NameNotFoundException on Android 11+ means UNKNOWN, not NOT_INSTALLED.
   * No QUERY_ALL_PACKAGES permission, device inventory or hidden-package
   * enumeration is requested.
   */
  private static V2AndroidInstalledPackageState.Observation observeInstalled(
      Context context,String packageId)throws Exception{
    PackageManager pm=context.getPackageManager();
    try{
      if(Build.VERSION.SDK_INT>=28){
        PackageInfo info=pm.getPackageInfo(packageId,PackageManager.GET_SIGNING_CERTIFICATES);
        if(info.signingInfo==null)throw new SecurityException("installed package signer unavailable");
        android.content.pm.Signature[] certs=info.signingInfo.getApkContentsSigners();
        if(certs==null||certs.length!=1)throw new SecurityException("unsupported installed signer identity");
        String sha=hex(MessageDigest.getInstance("SHA-256").digest(certs[0].toByteArray()));
        return new V2AndroidInstalledPackageState.Observation(
          info.packageName,sha,info.getLongVersionCode());
      }
      PackageInfo info=pm.getPackageInfo(packageId,PackageManager.GET_SIGNATURES);
      if(info.signatures==null||info.signatures.length!=1)
        throw new SecurityException("installed package signer unavailable");
      String sha=hex(MessageDigest.getInstance("SHA-256").digest(info.signatures[0].toByteArray()));
      return new V2AndroidInstalledPackageState.Observation(info.packageName,sha,info.versionCode);
    }catch(PackageManager.NameNotFoundException hiddenOrAbsent){
      // Android may filter the package from this caller. Never claim absence.
      return null;
    }
  }

  /** Only VERIFIED_INSTALLED proves an app is present; UNKNOWN is ambiguous. */
  static V2AndroidInstalledPackageState.State inspectInstalledRelease(
      Context context,V2SignedAndroidCatalog.Release release)throws Exception{
    if(context==null||release==null)throw new SecurityException("trusted release and context required");
    return V2AndroidInstalledPackageState.assess(
      release,observeInstalled(context,release.packageId));
  }

  /**
   * Only proceed after archive identity, signer, hash, and version are verified.
   * The Android system installer must display its standard user confirmation.
   */
  static Result requestInstall(Context context,V2SignedAndroidCatalog.Verified catalog,
                               String appId,File stagedApk)throws Exception{
    if(context==null||catalog==null||stagedApk==null)
      throw new SecurityException("verified installation inputs required");
    V2SignedAndroidCatalog.Release release=catalog.selectAndroid(appId);
    V2AndroidNativeInstallPolicy.ArchiveInfo inspected=inspect(context,stagedApk);
    V2AndroidInstalledPackageState.Observation existing=observeInstalled(context,release.packageId);
    V2AndroidInstalledPackageState.requireSafeInstall(release,existing);
    V2AndroidNativeInstallPolicy.verifyCandidate(
      context.getFilesDir(),stagedApk,release,inspected,
      existing==null?-1:existing.versionCode);
    if(Build.VERSION.SDK_INT>=26&&!context.getPackageManager().canRequestPackageInstalls()){
      Intent settings=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:"+context.getPackageName()));
      settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(settings);
      return Result.USER_APPROVAL_REQUIRED;
    }
    Uri packageUri=FileProvider.getUriForFile(context,"com.musitu.store.files",stagedApk);
    // Preserve a scoped read grant for Android's installer staging activity,
    // even when the first installer activity forwards the package internally.
    // No broad storage permission or exported FileProvider is required.
    Intent systemInstaller=new Intent(Intent.ACTION_VIEW)
      .setDataAndType(packageUri,"application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
    systemInstaller.setClipData(ClipData.newRawUri("verified APK",packageUri));
    // Android 11's InstallStart can forward the URI to a separate InstallStaging
    // Activity without forwarding transient Intent flags. Grant read access
    // to the one resolved trusted OS installer PACKAGE, not to arbitrary apps.
    ResolveInfo handler=context.getPackageManager().resolveActivity(
      systemInstaller,PackageManager.MATCH_DEFAULT_ONLY);
    if(handler==null||handler.activityInfo==null||
        handler.activityInfo.applicationInfo==null)
      throw new SecurityException("no trusted Android system APK installer");
    ApplicationInfo installerInfo=handler.activityInfo.applicationInfo;
    if((installerInfo.flags&(ApplicationInfo.FLAG_SYSTEM|
        ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))==0)
      throw new SecurityException("APK installer is not a system application");
    String installerPackage=handler.activityInfo.packageName;
    systemInstaller.setPackage(installerPackage);
    // Arm a private one-APK expiry before granting access; persistent explicit
    // URI grants may otherwise survive this process until revocation/reboot.
    V2InstallerUriLeaseReceiver.arm(context,stagedApk);
    try{
      context.grantUriPermission(installerPackage,packageUri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
      context.startActivity(systemInstaller);
    }catch(RuntimeException failed){
      try{context.revokeUriPermission(packageUri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}
      finally{V2InstallerUriLeaseReceiver.disarm(context,stagedApk);}
      throw failed;
    }
    return Result.SYSTEM_INSTALLER_LAUNCHED;
  }

  /**
   * After the OS installation finishes or the user cancels, the integrating
   * Activity MUST revoke the temporary per-APK grant. Until lifecycle wiring
   * is qualified the V2 bridge is not eligible for production rollout.
   */
  static void revokeInstallerUriGrant(Context context,File stagedApk)throws Exception{
    if(context==null||stagedApk==null)throw new SecurityException("grant cleanup requires APK");
    File apk=V2InstallerUriLeasePolicy.checkedLeasePath(context.getFilesDir(),stagedApk);
    Uri uri=FileProvider.getUriForFile(context,"com.musitu.store.files",apk);
    // Always revoke before removing the expiry backstop.
    context.revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
    V2InstallerUriLeaseReceiver.disarm(context,apk);
  }
  private V2AndroidInstallBridge(){}
}
