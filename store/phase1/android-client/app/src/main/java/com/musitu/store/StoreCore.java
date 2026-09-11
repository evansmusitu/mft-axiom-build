package com.musitu.store;

import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;

final class StoreCore {
  static final String CATALOG_URL="https://payments.mftintelligence.com/store/catalog.json";
  static final String SIG_URL="https://payments.mftintelligence.com/store/catalog.sig";
  static final String APP_CATALOG_ID="musitu-chemistry";
  static final String APP_ID="com.musitu.chemistry";
  static final int MAX_CATALOG_BYTES=1024*1024;
  static final int MAX_SIGNATURE_BYTES=16*1024;
  static final String PREFS="musitu_store";
  static final String PENDING_PATH="pending_install_path";
  static final String PENDING_BYTES="pending_install_bytes";
  static final String PENDING_SHA="pending_install_sha256";
  static final String PUB_PEM="-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE0CONtF2u0Ph/p8UIRYJ0LzWkF1uD\n3IjdH20cp8uLYwdkI9P9lB6H73ayNiQta6rDFq4Biz9O9Mrr/zqjJkMKkg==\n-----END PUBLIC KEY-----\n";
  static final String EXPECTED_APP_CERT="d4455ac3ec74a6d7cd7993ca640f554a83bba95dfd01ef508f7637b6bc72c0d8";

  static byte[] get(String u,int maxBytes) throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(u).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(45000);c.setRequestProperty("User-Agent","MUSITU-Store/1.0.3");c.setRequestProperty("Accept-Encoding","identity");
    try{int code=c.getResponseCode();if(code!=200)throw new IOException("HTTP "+code+" "+u);long declared=c.getContentLengthLong();if(declared>maxBytes)throw new IOException("response too large");
      try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[32768];for(int n;(n=in.read(b))>0;){if(out.size()+n>maxBytes)throw new IOException("response too large");out.write(b,0,n);}return out.toByteArray();}
    }finally{c.disconnect();}
  }
  static PublicKey publicKey() throws Exception {
    String b64=PUB_PEM.replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replaceAll("\\s","");
    return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(android.util.Base64.decode(b64, android.util.Base64.DEFAULT)));
  }
  static boolean verify(byte[] catalog, byte[] sig) throws Exception {java.security.Signature s=java.security.Signature.getInstance("SHA256withECDSA");s.initVerify(publicKey());s.update(catalog);return s.verify(sig);}
  static JSONObject fetchVerified(Context c) throws Exception {
    byte[] cat=get(CATALOG_URL,MAX_CATALOG_BYTES),sig=android.util.Base64.decode(new String(get(SIG_URL,MAX_SIGNATURE_BYTES),StandardCharsets.UTF_8).trim(),android.util.Base64.DEFAULT);
    if(!verify(cat,sig))throw new SecurityException("catalog signature invalid");
    JSONObject j=new JSONObject(new String(cat,StandardCharsets.UTF_8));chemistry(j);
    c.getSharedPreferences(PREFS,0).edit().putString("catalog",android.util.Base64.encodeToString(cat,android.util.Base64.NO_WRAP)).putString("sig",android.util.Base64.encodeToString(sig,android.util.Base64.NO_WRAP)).apply();
    return j;
  }
  static JSONObject cachedVerified(Context c) throws Exception {
    SharedPreferences p=c.getSharedPreferences(PREFS,0);String a=p.getString("catalog",null),b=p.getString("sig",null);if(a==null||b==null)throw new IOException("no cached catalog");
    byte[] cat=android.util.Base64.decode(a,android.util.Base64.DEFAULT),sig=android.util.Base64.decode(b,android.util.Base64.DEFAULT);if(cat.length>MAX_CATALOG_BYTES||sig.length>MAX_SIGNATURE_BYTES)throw new SecurityException("cached catalog is oversized");if(!verify(cat,sig))throw new SecurityException("cached signature invalid");JSONObject j=new JSONObject(new String(cat,StandardCharsets.UTF_8));chemistry(j);return j;
  }
  static JSONObject chemistry(JSONObject cat) throws Exception {
    if(!"musitu.store.catalog.v1".equals(cat.optString("schema")))throw new SecurityException("unsupported catalog schema");
    JSONObject stable=cat.getJSONObject("channels").getJSONObject("stable");
    if(!"active".equals(stable.optString("state"))||stable.optBoolean("paused",true)||stable.optBoolean("withdrawn",true)||stable.optInt("rolloutPercent",0)!=100)throw new SecurityException("stable channel is not authorized for this client");
    JSONArray apps=cat.getJSONArray("apps");JSONObject app=null;
    for(int i=0;i<apps.length();i++){JSONObject candidate=apps.getJSONObject(i);if(APP_CATALOG_ID.equals(candidate.optString("id"))){if(app!=null)throw new SecurityException("duplicate Chemistry catalog entry");app=candidate;}}
    if(app==null)throw new SecurityException("Chemistry catalog entry missing");
    JSONArray releases=app.getJSONArray("releases");JSONObject selected=null;long selectedCode=-1;
    for(int i=0;i<releases.length();i++){JSONObject candidate=releases.getJSONObject(i);if(!"stable".equals(candidate.optString("channel"))||!"stable".equals(candidate.optString("status")))continue;long code=candidate.optLong("versionCode",-1);if(code>selectedCode){validateRelease(candidate);selected=candidate;selectedCode=code;}}
    if(selected==null)throw new SecurityException("authorized stable Chemistry release missing");return selected;
  }
  static void validateRelease(JSONObject release)throws Exception{
    long code=release.optLong("versionCode",-1);if(code<=0)throw new SecurityException("invalid release version");JSONObject a=release.getJSONObject("android");
    if(!APP_ID.equals(a.optString("packageId")))throw new SecurityException("catalog package identity mismatch");if(!EXPECTED_APP_CERT.equalsIgnoreCase(a.optString("signingCertificateSha256")))throw new SecurityException("catalog signing certificate mismatch");
    validateDownloadMetadata(a.getString("apkURL"),a.getLong("bytes"),a.getString("sha256"));
  }
  static void validateDownloadMetadata(String url,long expectedBytes,String expectedSha)throws Exception{
    NativeInstallPolicy.requireTrustedApk(url,expectedBytes,expectedSha);
  }
  static long installedVersion(Context c){try{PackageInfo p=c.getPackageManager().getPackageInfo(APP_ID,0);return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}catch(Exception e){return -1;}}
  static String sha256(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];for(int n;(n=in.read(b))>0;)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte x:d.digest())s.append(String.format("%02x",x));return s.toString();}
  static String certSha(Context c,File apk)throws Exception{
    PackageManager pm=c.getPackageManager();PackageInfo p;
    if(Build.VERSION.SDK_INT>=28){p=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES);if(p==null||p.signingInfo==null)throw new SecurityException("missing signing info");android.content.pm.Signature[] ss=p.signingInfo.getApkContentsSigners();if(ss.length!=1)throw new SecurityException("unexpected signer count");return hex(MessageDigest.getInstance("SHA-256").digest(ss[0].toByteArray()));}
    p=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNATURES);if(p==null||p.signatures==null||p.signatures.length!=1)throw new SecurityException("missing legacy signer");return hex(MessageDigest.getInstance("SHA-256").digest(p.signatures[0].toByteArray()));
  }
  static String packageName(Context c,File apk)throws Exception{PackageInfo p=c.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(),0);if(p==null)throw new SecurityException("APK parse failed");return p.packageName;}
  static String hex(byte[] x){StringBuilder s=new StringBuilder();for(byte b:x)s.append(String.format("%02x",b));return s.toString();}
  static void verifyDownloadedApk(Context c,File apk,long expectedBytes,String expectedSha)throws Exception{
    NativeInstallPolicy.requireExpectedArtifact(expectedBytes,expectedSha);File allowed=new File(c.getFilesDir(),"downloads").getCanonicalFile(),actual=apk.getCanonicalFile();String prefix=allowed.getPath()+File.separator;
    if(!actual.getPath().startsWith(prefix))throw new SecurityException("installer path outside private Store storage");if(!actual.isFile()||actual.length()!=expectedBytes)throw new IOException("size mismatch");
    if(!sha256(actual).equalsIgnoreCase(expectedSha))throw new SecurityException("SHA-256 mismatch");if(!packageName(c,actual).equals(APP_ID))throw new SecurityException("package identity mismatch");if(!certSha(c,actual).equalsIgnoreCase(EXPECTED_APP_CERT))throw new SecurityException("signing certificate mismatch");
  }
  static File download(Context c,String url,long expectedBytes,String expectedSha,Progress progress)throws Exception{
    validateDownloadMetadata(url,expectedBytes,expectedSha);File dir=new File(c.getFilesDir(),"downloads");if(!dir.exists()&&!dir.mkdirs())throw new IOException("cannot create private download storage");File part=new File(dir,"chemistry.apk.part"),dest=new File(dir,"MUSITU_Chemistry.apk");long have=part.exists()?part.length():0;if(have<0||have>expectedBytes){if(!part.delete())throw new IOException("cannot reset invalid partial download");have=0;}
    HttpURLConnection h=(HttpURLConnection)new URL(url).openConnection();h.setInstanceFollowRedirects(false);h.setConnectTimeout(15000);h.setReadTimeout(60000);h.setRequestProperty("User-Agent","MUSITU-Store/1.0.3");h.setRequestProperty("Accept-Encoding","identity");if(have>0)h.setRequestProperty("Range","bytes="+have+"-");
    try{int code=h.getResponseCode();if(have>0&&code==200){if(!part.delete())throw new IOException("cannot restart partial download");have=0;}else if(have>0&&code==206){String range=h.getHeaderField("Content-Range");if(range==null||!range.startsWith("bytes "+have+"-"))throw new IOException("invalid download range response");}else if(have==0&&code!=200)throw new IOException("download HTTP "+code);else if(code!=200&&code!=206)throw new IOException("download HTTP "+code);
      long remaining=expectedBytes-have,declared=h.getContentLengthLong();if(declared>remaining)throw new IOException("download response too large");
      try(InputStream in=h.getInputStream();OutputStream out=new FileOutputStream(part,have>0)){byte[] b=new byte[65536];long nsum=have;for(int n;(n=in.read(b))>0;){nsum+=n;if(nsum>expectedBytes)throw new IOException("download exceeded expected size");out.write(b,0,n);if(progress!=null)progress.on(nsum,expectedBytes);}}
    }catch(Exception e){if(part.length()>expectedBytes)part.delete();throw e;}finally{h.disconnect();}
    if(part.length()!=expectedBytes){part.delete();throw new IOException("size mismatch");}if(!sha256(part).equalsIgnoreCase(expectedSha)){part.delete();throw new SecurityException("SHA-256 mismatch");}if(!packageName(c,part).equals(APP_ID)){part.delete();throw new SecurityException("package identity mismatch");}if(!certSha(c,part).equalsIgnoreCase(EXPECTED_APP_CERT)){part.delete();throw new SecurityException("signing certificate mismatch");}
    if(dest.exists()&&!dest.delete())throw new IOException("cannot replace prior verified download");if(!part.renameTo(dest))throw new IOException("finalize failed");return dest;
  }
  static void rememberPendingInstall(Context c,File apk,long expectedBytes,String expectedSha)throws Exception{c.getSharedPreferences(PREFS,0).edit().putString(PENDING_PATH,apk.getCanonicalPath()).putLong(PENDING_BYTES,expectedBytes).putString(PENDING_SHA,expectedSha.toLowerCase()).commit();}
  static void clearPendingInstall(Context c){c.getSharedPreferences(PREFS,0).edit().remove(PENDING_PATH).remove(PENDING_BYTES).remove(PENDING_SHA).commit();}
  static void launchPackageInstaller(Context c,File apk){Uri u=FileProvider.getUriForFile(c,"com.musitu.store.files",apk);Intent i=new Intent(Intent.ACTION_VIEW).setDataAndType(u,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);c.startActivity(i);}
  static boolean install(Context c,File apk,long expectedBytes,String expectedSha)throws Exception{
    verifyDownloadedApk(c,apk,expectedBytes,expectedSha);if(Build.VERSION.SDK_INT>=26&&!c.getPackageManager().canRequestPackageInstalls()){rememberPendingInstall(c,apk,expectedBytes,expectedSha);Intent s=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+c.getPackageName()));s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);c.startActivity(s);return false;}
    launchPackageInstaller(c,apk);clearPendingInstall(c);return true;
  }
  static boolean resumePendingInstall(Context c)throws Exception{
    SharedPreferences p=c.getSharedPreferences(PREFS,0);String path=p.getString(PENDING_PATH,null),expectedSha=p.getString(PENDING_SHA,null);long expectedBytes=p.getLong(PENDING_BYTES,-1);if(path==null)return false;if(Build.VERSION.SDK_INT>=26&&!c.getPackageManager().canRequestPackageInstalls())return false;
    File apk=new File(path);try{verifyDownloadedApk(c,apk,expectedBytes,expectedSha);}catch(Exception e){clearPendingInstall(c);throw e;}launchPackageInstaller(c,apk);clearPendingInstall(c);return true;
  }
  static void openApp(Context c){Intent i=c.getPackageManager().getLaunchIntentForPackage(APP_ID);if(i!=null)c.startActivity(i);}
  interface Progress{void on(long done,long total);}
}
