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
  private static long installedVersion(Context context,String packageId){
    try{
      PackageInfo installed=context.getPackageManager().getPackageInfo(packageId,0);
      return Build.VERSION.SDK_INT>=28?installed.getLongVersionCode():installed.versionCode;
    }catch(PackageManager.NameNotFoundException ignored){
      // Android package visibility may conceal installed apps; Android installer
      // remains the final anti-downgrade and signing compatibility authority.
      return -1;
    }
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
    V2AndroidNativeInstallPolicy.verifyCandidate(
      context.getFilesDir(),stagedApk,release,inspected,installedVersion(context,release.packageId));
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
    context.grantUriPermission(installerPackage,packageUri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try{
      context.startActivity(systemInstaller);
    }catch(RuntimeException failed){
      context.revokeUriPermission(packageUri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
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
    File base=new File(context.getFilesDir(),"downloads/v2").getCanonicalFile();
    File apk=stagedApk.getCanonicalFile();
    if(!apk.getPath().startsWith(base.getPath()+File.separator))
      throw new SecurityException("cannot revoke outside verified Store downloads");
    Uri uri=FileProvider.getUriForFile(context,"com.musitu.store.files",apk);
    context.revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
  }
  private V2AndroidInstallBridge(){}
}
