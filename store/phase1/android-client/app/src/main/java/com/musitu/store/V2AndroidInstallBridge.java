package com.musitu.store;

import android.content.Context;
import android.content.Intent;
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
    Intent systemInstaller=new Intent(Intent.ACTION_VIEW)
      .setDataAndType(packageUri,"application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(systemInstaller);
    return Result.SYSTEM_INSTALLER_LAUNCHED;
  }
  private V2AndroidInstallBridge(){}
}
