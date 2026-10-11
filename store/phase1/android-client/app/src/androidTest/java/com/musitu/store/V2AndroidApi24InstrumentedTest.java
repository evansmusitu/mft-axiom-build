package com.musitu.store;

import android.content.Context;
import android.os.Build;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.text.SimpleDateFormat;
import java.util.*;
import static org.junit.Assert.*;

/**
 * Runs the real Android JVM on API 24 (and newer), not a mock desktop Android.
 * Test artifact is NOT a real APK; positive installation remains a separate gate.
 */
@RunWith(AndroidJUnit4.class)
public final class V2AndroidApi24InstrumentedTest {
  private static String hex(byte[] bytes)throws Exception{
    StringBuilder b=new StringBuilder();for(byte x:MessageDigest.getInstance("SHA-256").digest(bytes))
      b.append(String.format(Locale.ROOT,"%02x",x&255));return b.toString();
  }
  private static String iso(long time){
    SimpleDateFormat df=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);
    df.setTimeZone(TimeZone.getTimeZone("UTC"));
    return df.format(new Date(time));
  }
  private static JSONObject release(byte[] payload)throws Exception{
    return new JSONObject()
      .put("platform","android").put("packageId","org.musitu.testapp")
      .put("version","1.0.0").put("versionCode",100)
      .put("sha256",hex(payload)).put("bytes",payload.length)
      .put("artifactURL","https://payments.mftintelligence.com/store/android/repo/test-app.apk")
      .put("signingCertificateSha256",repeat('b',64));
  }
  private static String repeat(char ch,int length){char[] a=new char[length];Arrays.fill(a,ch);return new String(a);}
  private static class Fixture {
    V2SignedAndroidCatalog.Verified verified;
    byte[] payload;
    byte[] raw;
    byte[] signature;
    String pem,pin;
    Fixture()throws Exception{
      payload="v2 catalog synthetic data - not a real APK".getBytes(StandardCharsets.UTF_8);
      long now=System.currentTimeMillis();
      JSONObject grant=new JSONObject()
        .put("platform","android")
        .put("packageId","org.musitu.testapp")
        .put("signingCertificateSha256",repeat('b',64));
      JSONObject publisher=new JSONObject()
        .put("id","operator-test").put("name","Test Publisher")
        .put("grants",new JSONArray().put(grant));
      JSONObject application=new JSONObject()
        .put("id","musitu-test-app").put("publisherId","operator-test")
        .put("releases",new JSONArray().put(release(payload)));
      JSONObject catalog=new JSONObject()
        .put("schema","musitu.store.catalog.v2").put("revision",1)
        .put("issuedAt",iso(now-60_000)).put("expiresAt",iso(now+3_600_000))
        .put("publishers",new JSONArray().put(publisher))
        .put("apps",new JSONArray().put(application));
      JSONObject otherGrant=new JSONObject()
        .put("platform","android").put("packageId","org.northstar.testapp")
        .put("signingCertificateSha256",repeat('c',64));
      JSONObject otherPublisher=new JSONObject()
        .put("id","northstar").put("name","Northstar Publisher")
        .put("grants",new JSONArray().put(otherGrant));
      JSONObject otherRelease=release(payload)
        .put("packageId","org.northstar.testapp")
        .put("signingCertificateSha256",repeat('c',64));
      JSONObject otherApp=new JSONObject()
        .put("id","northstar-app").put("publisherId","northstar")
        .put("releases",new JSONArray().put(otherRelease));
      catalog.getJSONArray("publishers").put(otherPublisher);
      catalog.getJSONArray("apps").put(otherApp);
      raw=catalog.toString().getBytes(StandardCharsets.UTF_8);
      KeyPairGenerator g=KeyPairGenerator.getInstance("EC");
      g.initialize(new ECGenParameterSpec("secp256r1"));
      KeyPair key=g.generateKeyPair();
      pem="-----BEGIN PUBLIC KEY-----\n"+
        android.util.Base64.encodeToString(key.getPublic().getEncoded(),android.util.Base64.NO_WRAP)+
        "\n-----END PUBLIC KEY-----\n";
      pin=hex(pem.getBytes(StandardCharsets.UTF_8));
      Signature s=Signature.getInstance("SHA256withECDSA");
      s.initSign(key.getPrivate());s.update(raw);signature=s.sign();
      verified=V2SignedAndroidCatalog.verify(raw,signature,pem,pin,0,null,
        Collections.singletonList("payments.mftintelligence.com"),now);
    }
  }
  @Test public void actualApi24CanVerifyP256SignatureAndSelectAuthorizedPackage()throws Exception{
    Fixture fixture=new Fixture();
    V2SignedAndroidCatalog.Release r=fixture.verified.selectAndroid("musitu-test-app");
    assertEquals("org.musitu.testapp",r.packageId);
    assertEquals("operator-test",r.publisherId);
    assertEquals(fixture.payload.length,r.bytes);
  }
  @Test public void actualApi24RejectsTamperedSignedCatalog()throws Exception{
    Fixture fixture=new Fixture();
    byte[] changed=fixture.raw.clone();changed[changed.length-2]^=1;
    try{
      V2SignedAndroidCatalog.verify(changed,fixture.signature,fixture.pem,fixture.pin,0,null,
        Collections.singletonList("payments.mftintelligence.com"),System.currentTimeMillis());
      fail("API24 accepted tampered signature");
    }catch(SecurityException expected){}
  }
  @Test public void actualApi24RejectsFakePackageBeforeLaunchingSystemInstaller()throws Exception{
    Fixture fixture=new Fixture();
    Context context=ApplicationProvider.getApplicationContext();
    V2SignedAndroidCatalog.Release r=fixture.verified.selectAndroid("musitu-test-app");
    File candidate=V2AndroidNativeInstallPolicy.stage(
      new ByteArrayInputStream(fixture.payload),context.getFilesDir(),r);
    try {
      V2AndroidInstallBridge.requestInstall(context,fixture.verified,"musitu-test-app",candidate);
      fail("non-APK bytes must not invoke Android's system installer");
    } catch(SecurityException expected) {
      // PackageManager inspection rejects the synthetic non-APK before user prompt.
    }
  }

  @Test public void actualApi24DisplaysTwoVerifiedPublisherApplications()throws Exception{
    Fixture fixture=new Fixture();
    Context context=ApplicationProvider.getApplicationContext();
    final java.util.List<String> selections=new java.util.ArrayList<>();
    android.view.View view=V2AndroidAppBrowser.render(context,fixture.verified,
      chosen->selections.add(chosen.appId));
    assertTrue(view instanceof android.widget.ScrollView);
    android.widget.LinearLayout container=(android.widget.LinearLayout)
      ((android.widget.ScrollView)view).getChildAt(0);
    java.util.List<android.widget.Button> choices=new java.util.ArrayList<>();
    for(int n=0;n<container.getChildCount();n++){
      android.view.View child=container.getChildAt(n);
      if(child instanceof android.widget.Button)choices.add((android.widget.Button)child);
    }
    assertEquals("only two verified releases may be actionable",2,choices.size());
    assertEquals("review:musitu-test-app",choices.get(0).getTag());
    assertEquals("review:northstar-app",choices.get(1).getTag());
    choices.get(0).performClick();
    choices.get(1).performClick();
    assertEquals(java.util.Arrays.asList("musitu-test-app","northstar-app"),selections);
  }
  @Test public void actualApi24NeverRendersUnsignedOrMissingRegistry()throws Exception{
    try{
      V2AndroidAppBrowser.render(ApplicationProvider.getApplicationContext(),null,
        selected->{});
      fail("unsigned or missing V2 registry was rendered");
    }catch(SecurityException expected){}
  }

  @Test public void actualApi24DoesNotAcceptSelfSignedPublisherRootAtProductionBoundary()throws Exception{
    Fixture fixture=new Fixture();
    Context context=ApplicationProvider.getApplicationContext();
    context.getSharedPreferences(V2AndroidCatalogAuthority.PREFS,Context.MODE_PRIVATE)
      .edit().clear().commit();
    try {
      V2AndroidCatalogAuthority.acceptAndCommit(
        context,fixture.raw,fixture.signature,System.currentTimeMillis());
      fail("privately generated publisher root must not be trusted as Store production authority");
    }catch(SecurityException expected){}
  }
  @Test public void actualApi24RejectsCorruptDurableCatalogWatermark()throws Exception{
    Fixture fixture=new Fixture();
    Context context=ApplicationProvider.getApplicationContext();
    context.getSharedPreferences(V2AndroidCatalogAuthority.PREFS,Context.MODE_PRIVATE)
      .edit().putBoolean("initialized",true).putLong("revision",2).putString("digest","broken").commit();
    try{
      V2AndroidCatalogAuthority.acceptAndCommit(
        context,fixture.raw,fixture.signature,System.currentTimeMillis());
      fail("invalid trusted state was ignored");
    }catch(SecurityException expected){}finally{
      context.getSharedPreferences(V2AndroidCatalogAuthority.PREFS,Context.MODE_PRIVATE)
        .edit().clear().commit();
    }
  }
}
