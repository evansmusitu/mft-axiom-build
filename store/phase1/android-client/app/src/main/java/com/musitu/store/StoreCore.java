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
import java.security.cert.CertificateFactory;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;

final class StoreCore {
  static final String CATALOG_URL="https://payments.mftintelligence.com/store/catalog.json";
  static final String SIG_URL="https://payments.mftintelligence.com/store/catalog.sig";
  static final String APP_ID="com.musitu.chemistry";
  static final String PUB_PEM="-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE0CONtF2u0Ph/p8UIRYJ0LzWkF1uD\n3IjdH20cp8uLYwdkI9P9lB6H73ayNiQta6rDFq4Biz9O9Mrr/zqjJkMKkg==\n-----END PUBLIC KEY-----\n";
  static final String EXPECTED_APP_CERT="d4455ac3ec74a6d7cd7993ca640f554a83bba95dfd01ef508f7637b6bc72c0d8";

  static byte[] get(String u) throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(u).openConnection(); c.setConnectTimeout(15000);c.setReadTimeout(45000);c.setRequestProperty("User-Agent","MUSITU-Store/1.0");
    int code=c.getResponseCode(); if(code!=200)throw new IOException("HTTP "+code+" "+u);
    try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[32768];for(int n;(n=in.read(b))>0;)out.write(b,0,n);return out.toByteArray();}
  }
  static PublicKey publicKey() throws Exception {
    String b64=PUB_PEM.replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replaceAll("\\s","");
    return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(android.util.Base64.decode(b64, android.util.Base64.DEFAULT)));
  }
  static boolean verify(byte[] catalog, byte[] sig) throws Exception {java.security.Signature s=java.security.Signature.getInstance("SHA256withECDSA");s.initVerify(publicKey());s.update(catalog);return s.verify(sig);}
  static JSONObject fetchVerified(Context c) throws Exception {
    byte[] cat=get(CATALOG_URL), sig=android.util.Base64.decode(new String(get(SIG_URL),StandardCharsets.UTF_8).trim(), android.util.Base64.DEFAULT);
    if(!verify(cat,sig))throw new SecurityException("catalog signature invalid");
    JSONObject j=new JSONObject(new String(cat,StandardCharsets.UTF_8));
    c.getSharedPreferences("musitu_store",0).edit().putString("catalog",android.util.Base64.encodeToString(cat, android.util.Base64.NO_WRAP)).putString("sig",android.util.Base64.encodeToString(sig, android.util.Base64.NO_WRAP)).apply();
    return j;
  }
  static JSONObject cachedVerified(Context c) throws Exception {
    SharedPreferences p=c.getSharedPreferences("musitu_store",0);String a=p.getString("catalog",null),b=p.getString("sig",null);if(a==null||b==null)throw new IOException("no cached catalog");
    byte[] cat=android.util.Base64.decode(a, android.util.Base64.DEFAULT),sig=android.util.Base64.decode(b, android.util.Base64.DEFAULT);if(!verify(cat,sig))throw new SecurityException("cached signature invalid");return new JSONObject(new String(cat,StandardCharsets.UTF_8));
  }
  static JSONObject chemistry(JSONObject cat) throws Exception {return cat.getJSONArray("apps").getJSONObject(0).getJSONArray("releases").getJSONObject(0);}
  static long installedVersion(Context c){try{PackageInfo p=c.getPackageManager().getPackageInfo(APP_ID,0);return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}catch(Exception e){return -1;}}
  static String sha256(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];for(int n;(n=in.read(b))>0;)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte x:d.digest())s.append(String.format("%02x",x));return s.toString();}
  static String certSha(Context c, File apk)throws Exception{
    PackageManager pm=c.getPackageManager();PackageInfo p;
    if(Build.VERSION.SDK_INT>=28){p=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES);if(p==null||p.signingInfo==null)throw new SecurityException("missing signing info");android.content.pm.Signature[] ss=p.signingInfo.getApkContentsSigners();if(ss.length!=1)throw new SecurityException("unexpected signer count");return hex(MessageDigest.getInstance("SHA-256").digest(ss[0].toByteArray()));}
    p=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNATURES);if(p==null||p.signatures==null||p.signatures.length!=1)throw new SecurityException("missing legacy signer");return hex(MessageDigest.getInstance("SHA-256").digest(p.signatures[0].toByteArray()));
  }
  static String packageName(Context c,File apk)throws Exception{PackageInfo p=c.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(),0);if(p==null)throw new SecurityException("APK parse failed");return p.packageName;}
  static String hex(byte[] x){StringBuilder s=new StringBuilder();for(byte b:x)s.append(String.format("%02x",b));return s.toString();}
  static File download(Context c,String url,long expectedBytes,String expectedSha, Progress progress)throws Exception{
    File dir=new File(c.getFilesDir(),"downloads");dir.mkdirs();File part=new File(dir,"chemistry.apk.part"),dest=new File(dir,"MUSITU_Chemistry_1.3.0.apk");long have=part.exists()?part.length():0;
    HttpURLConnection h=(HttpURLConnection)new URL(url).openConnection();h.setConnectTimeout(15000);h.setReadTimeout(60000);h.setRequestProperty("User-Agent","MUSITU-Store/1.0");if(have>0)h.setRequestProperty("Range","bytes="+have+"-");int code=h.getResponseCode();if(code==200&&have>0){part.delete();have=0;}else if(code!=200&&code!=206)throw new IOException("download HTTP "+code);
    try(InputStream in=h.getInputStream();OutputStream out=new FileOutputStream(part,have>0)){byte[] b=new byte[65536];long nsum=have;for(int n;(n=in.read(b))>0;){out.write(b,0,n);nsum+=n;if(progress!=null)progress.on(nsum,expectedBytes);}}
    if(part.length()!=expectedBytes){part.delete();throw new IOException("size mismatch");}if(!sha256(part).equalsIgnoreCase(expectedSha)){part.delete();throw new SecurityException("SHA-256 mismatch");}
    if(!packageName(c,part).equals(APP_ID)){part.delete();throw new SecurityException("package identity mismatch");}if(!certSha(c,part).equalsIgnoreCase(EXPECTED_APP_CERT)){part.delete();throw new SecurityException("signing certificate mismatch");}
    if(dest.exists())dest.delete();if(!part.renameTo(dest))throw new IOException("finalize failed");return dest;
  }
  static void install(Context c,File apk){
    if(Build.VERSION.SDK_INT>=26&&!c.getPackageManager().canRequestPackageInstalls()){Intent s=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:"+c.getPackageName()));s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);c.startActivity(s);return;}
    Uri u=FileProvider.getUriForFile(c,"com.musitu.store.files",apk);Intent i=new Intent(Intent.ACTION_VIEW).setDataAndType(u,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);c.startActivity(i);
  }
  static void openApp(Context c){Intent i=c.getPackageManager().getLaunchIntentForPackage(APP_ID);if(i!=null)c.startActivity(i);}
  interface Progress{void on(long done,long total);}
}
