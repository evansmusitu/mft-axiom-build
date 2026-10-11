package com.musitu.store;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.text.SimpleDateFormat;
import java.util.*;
import static org.junit.Assert.*;

/**
 * Verified on a disposable Android emulator only. The two Android APKs are
 * built and signed with separate ephemeral CI keystores, never public keys.
 *
 * Qualification: actual Android package archive parsing, certificate,
 * byte-for-byte staging, cross-publisher rejection and normal OS handoff.
 * NOT proof that a human approved and completed installation.
 */
@RunWith(AndroidJUnit4.class)
public final class V2RealApkInstrumentedTest {
  private static final String HOST="payments.mftintelligence.com";
  private static final String[] IDS={"fixture-alpha","fixture-beta"};
  private static final String[] PUBS={"fixture-publisher-alpha","fixture-publisher-beta"};
  private static final String[] PKGS={"org.musitu.fixturealpha","org.musitu.fixturebeta"};

  private static String hex(byte[] data)throws Exception{
    byte[] digest=MessageDigest.getInstance("SHA-256").digest(data);
    StringBuilder sb=new StringBuilder();
    for(byte b:digest)sb.append(String.format(Locale.ROOT,"%02x",b&255));
    return sb.toString();
  }
  private static String iso(long t){
    SimpleDateFormat df=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);
    df.setTimeZone(TimeZone.getTimeZone("UTC"));return df.format(new Date(t));
  }
  static final class Archive {
    final File file;final byte[] bytes;final String pkg,cert;final long version;
    Archive(Context ctx,int i)throws Exception{
      file=new File(ctx.getFilesDir(),"v2-real-fixture-"+(i==0?"alpha":"beta")+".apk");
      assertTrue("CI must install fixture into private Store test directory: "+file,file.isFile());
      ByteArrayOutputStream buffer=new ByteArrayOutputStream();
      try(FileInputStream stream=new FileInputStream(file)){
        byte[] block=new byte[65536];
        for(int n;(n=stream.read(block))!=-1;)if(n>0)buffer.write(block,0,n);
      }
      bytes=buffer.toByteArray();
      assertTrue(bytes.length>512);
      PackageInfo info=ctx.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),PackageManager.GET_SIGNATURES);
      assertNotNull("must be an actual Android APK archive",info);
      assertNotNull(info.signatures);
      assertEquals(1,info.signatures.length);
      pkg=info.packageName;cert=hex(info.signatures[0].toByteArray());
      version=info.versionCode;
      assertEquals(PKGS[i],pkg);
      assertEquals(100L,version);
    }
  }
  static final class Signed {
    final V2SignedAndroidCatalog.Verified catalog;
    final Archive[] archives;
    Signed(Context ctx,boolean wrongAlphaSigner)throws Exception{
      archives=new Archive[]{new Archive(ctx,0),new Archive(ctx,1)};
      JSONArray publishers=new JSONArray(),apps=new JSONArray();
      for(int i=0;i<2;i++){
        Archive a=archives[i];
        String cert=i==0&&wrongAlphaSigner?archives[1].cert:a.cert;
        JSONObject grant=new JSONObject()
          .put("platform","android").put("packageId",a.pkg)
          .put("signingCertificateSha256",cert);
        publishers.put(new JSONObject().put("id",PUBS[i]).put("name","Disposable Test Publisher "+i)
          .put("grants",new JSONArray().put(grant)));
        JSONObject release=new JSONObject()
          .put("platform","android").put("packageId",a.pkg).put("signingCertificateSha256",cert)
          .put("version","1.0.0").put("versionCode",a.version)
          .put("artifactURL","https://"+HOST+"/store/android/repo/"+IDS[i]+".apk")
          .put("sha256",hex(a.bytes)).put("bytes",a.bytes.length);
        apps.put(new JSONObject().put("id",IDS[i]).put("publisherId",PUBS[i])
          .put("releases",new JSONArray().put(release)));
      }
      long now=System.currentTimeMillis();
      JSONObject data=new JSONObject()
        .put("schema","musitu.store.catalog.v2").put("revision",1)
        .put("issuedAt",iso(now-60000)).put("expiresAt",iso(now+3600000))
        .put("publishers",publishers).put("apps",apps);
      byte[] raw=data.toString().getBytes(StandardCharsets.UTF_8);
      KeyPairGenerator gen=KeyPairGenerator.getInstance("EC");
      gen.initialize(new ECGenParameterSpec("secp256r1"));KeyPair key=gen.generateKeyPair();
      String pem="-----BEGIN PUBLIC KEY-----\n"+
        android.util.Base64.encodeToString(key.getPublic().getEncoded(),android.util.Base64.NO_WRAP)+
        "\n-----END PUBLIC KEY-----\n";
      Signature sig=Signature.getInstance("SHA256withECDSA");
      sig.initSign(key.getPrivate());sig.update(raw);
      catalog=V2SignedAndroidCatalog.verify(raw,sig.sign(),pem,hex(pem.getBytes(StandardCharsets.UTF_8)),
        0,null,Collections.singletonList(HOST),now);
    }
  }
  private static File stage(Context ctx,Archive archive,V2SignedAndroidCatalog.Release release)throws Exception{
    return V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(archive.bytes),ctx.getFilesDir(),release);
  }
  private static V2AndroidNativeInstallPolicy.ArchiveInfo inspect(Archive a){
    return new V2AndroidNativeInstallPolicy.ArchiveInfo(a.pkg,a.cert,a.version);
  }

  @Test public void verifiesTwoGenuineSignedAPKArchivesFromDifferentPublishers()throws Exception{
    Context ctx=ApplicationProvider.getApplicationContext();Signed s=new Signed(ctx,false);
    assertNotEquals("fixture publishers must use independent signing certificates",s.archives[0].cert,s.archives[1].cert);
    assertEquals(2,s.catalog.androidReleases.size());
    for(int i=0;i<2;i++){
      V2SignedAndroidCatalog.Release release=s.catalog.selectAndroid(IDS[i]);
      assertEquals(PUBS[i],release.publisherId);
      File f=stage(ctx,s.archives[i],release);
      V2AndroidNativeInstallPolicy.verifyCandidate(ctx.getFilesDir(),f,release,inspect(s.archives[i]),-1);
      assertEquals(hex(s.archives[i].bytes),release.sha256);
    }
  }

  @Test public void rejectsCrossPublisherBinaryEvenWhenBothAPKsAreIndividuallyValid()throws Exception{
    Context ctx=ApplicationProvider.getApplicationContext();Signed s=new Signed(ctx,false);
    V2SignedAndroidCatalog.Release a=s.catalog.selectAndroid("fixture-alpha");
    try{
      stage(ctx,s.archives[1],a);
      fail("cross-publisher APK installed under a signed alpha release");
    }catch(SecurityException expected){}
  }

  @Test public void rejectsGenuinelySignedAPKWhenCatalogDelegatesWrongSigner()throws Exception{
    Context ctx=ApplicationProvider.getApplicationContext();Signed s=new Signed(ctx,true);
    V2SignedAndroidCatalog.Release alpha=s.catalog.selectAndroid("fixture-alpha");
    File f=stage(ctx,s.archives[0],alpha);
    try{
      V2AndroidNativeInstallPolicy.verifyCandidate(ctx.getFilesDir(),f,alpha,inspect(s.archives[0]),-1);
      fail("APK signer mismatch accepted");
    }catch(SecurityException expected){}
  }

  @Test public void rejectsByteTamperInGenuineSignedAPK()throws Exception{
    Context ctx=ApplicationProvider.getApplicationContext();Signed s=new Signed(ctx,false);
    byte[] bad=s.archives[0].bytes.clone();bad[bad.length/2]^=1;
    try{
      V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(bad),ctx.getFilesDir(),
        s.catalog.selectAndroid("fixture-alpha"));
      fail("tampered APK staged");
    }catch(SecurityException expected){}
  }

  @Test public void rejectsWrongAppSelectionBeforeAndroidInstaller()throws Exception{
    Context ctx=ApplicationProvider.getApplicationContext();Signed s=new Signed(ctx,false);
    File alpha=stage(ctx,s.archives[0],s.catalog.selectAndroid("fixture-alpha"));
    try{
      V2AndroidInstallBridge.requestInstall(ctx,s.catalog,"fixture-beta",alpha);
      fail("selected publisher identity was not enforced");
    }catch(SecurityException expected){}
  }

  @Test public void handoffOfVerifiedRealAPKRequiresNormalAndroidSystemInstaller()throws Exception{
    if(Build.VERSION.SDK_INT!=24)return; // First acceptance matrix is API24.
    Context ctx=ApplicationProvider.getApplicationContext();Signed s=new Signed(ctx,false);
    File alpha=stage(ctx,s.archives[0],s.catalog.selectAndroid("fixture-alpha"));
    assertEquals(V2AndroidInstallBridge.Result.SYSTEM_INSTALLER_LAUNCHED,
      V2AndroidInstallBridge.requestInstall(ctx,s.catalog,"fixture-alpha",alpha));
    // Starting Android's installer is NOT installation approval or completion.
  }
}
