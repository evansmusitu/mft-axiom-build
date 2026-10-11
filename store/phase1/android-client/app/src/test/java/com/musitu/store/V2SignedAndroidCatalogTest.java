package com.musitu.store;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

import static org.junit.Assert.*;

public final class V2SignedAndroidCatalogTest {
  static PrivateKey signer;
  static String pinnedPem;
  static String rootFingerprint;
  static final String SHA_A=repeat('a',64), CERT_A=repeat('b',64),CERT_B=repeat('c',64);
  static final long NOW=1791806400000L; // 2026-10-12T12:00:00Z
  static String repeat(char c,int n){char[] a=new char[n];Arrays.fill(a,c);return new String(a);}
  static String hex(byte[] a){StringBuilder s=new StringBuilder();for(byte b:a)s.append(String.format("%02x",b&255));return s.toString();}
  static String sha(String value)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
  @BeforeClass public static void key()throws Exception{
    KeyPairGenerator g=KeyPairGenerator.getInstance("EC");g.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
    KeyPair k=g.generateKeyPair();signer=k.getPrivate();
    String body=Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(k.getPublic().getEncoded());
    pinnedPem="-----BEGIN PUBLIC KEY-----\n"+body+"\n-----END PUBLIC KEY-----\n";
    rootFingerprint=sha(pinnedPem);
  }
  static JSONObject grant(String platform,String id,String cert)throws Exception{
    JSONObject g=new JSONObject().put("platform",platform).put("packageId",id);
    if(cert!=null)g.put("signingCertificateSha256",cert);return g;
  }
  static JSONObject release(String pkg,String cert,String url)throws Exception{
    return new JSONObject().put("platform","android").put("packageId",pkg)
      .put("version","1.0.0").put("versionCode",100).put("artifactURL",url)
      .put("sha256",SHA_A).put("bytes",2048).put("signingCertificateSha256",cert);
  }
  static JSONObject baseline()throws Exception{
    return new JSONObject()
     .put("schema","musitu.store.catalog.v2").put("revision",1)
     .put("issuedAt","2026-10-11T00:00:00.000Z").put("expiresAt","2026-10-18T00:00:00.000Z")
     .put("publishers",new JSONArray()
      .put(new JSONObject().put("id","musitu").put("name","MUSITU")
       .put("grants",new JSONArray().put(grant("android","com.musitu.chemistry",CERT_A))))
      .put(new JSONObject().put("id","northstar").put("name","Northstar Apps")
       .put("grants",new JSONArray().put(grant("android","org.northstar.app",CERT_B)))))
     .put("apps",new JSONArray()
      .put(new JSONObject().put("id","musitu-chemistry").put("publisherId","musitu")
       .put("releases",new JSONArray().put(release("com.musitu.chemistry",CERT_A,
         "https://payments.mftintelligence.com/store/android/repo/chemistry.apk"))))
      .put(new JSONObject().put("id","northstar-app").put("publisherId","northstar")
       .put("releases",new JSONArray().put(release("org.northstar.app",CERT_B,
         "https://payments.mftintelligence.com/store/android/repo/northstar.apk")))));
  }
  static byte[] sig(byte[] raw)throws Exception{
    Signature s=Signature.getInstance("SHA256withECDSA");s.initSign(signer);s.update(raw);return s.sign();
  }
  static V2SignedAndroidCatalog.Verified accept(JSONObject j)throws Exception{
    return accept(j,0,null);
  }
  static V2SignedAndroidCatalog.Verified accept(JSONObject j,long prior,String priorDigest)throws Exception{
    byte[] bytes=j.toString().getBytes(StandardCharsets.UTF_8);
    return V2SignedAndroidCatalog.verify(bytes,sig(bytes),pinnedPem,rootFingerprint,prior,priorDigest,
      Collections.singletonList("payments.mftintelligence.com"),NOW);
  }
  @Test public void twoIndependentPublishersCanSelectTheirOwnAndroidPackages()throws Exception{
    V2SignedAndroidCatalog.Verified out=accept(baseline());
    assertEquals(1,out.revision);
    assertEquals(2,out.androidReleases.size());
    assertEquals("com.musitu.chemistry",out.selectAndroid("musitu-chemistry").packageId);
    assertEquals("org.northstar.app",out.selectAndroid("northstar-app").packageId);
    assertNotEquals(out.selectAndroid("musitu-chemistry").publisherId,out.selectAndroid("northstar-app").publisherId);
  }
  @Test public void unknownAppCannotBeSelected()throws Exception{
    V2SignedAndroidCatalog.Verified out=accept(baseline());
    try{out.selectAndroid("attacker");fail("unknown app accepted");}catch(SecurityException expected){}
  }
  @Test public void postSignatureMetadataTamperingIsRejected()throws Exception{
    byte[] raw=baseline().toString().getBytes(StandardCharsets.UTF_8),signed=sig(raw);
    String swapped=new String(raw,StandardCharsets.UTF_8).replace("northstar-app","attacker-app");
    try{V2SignedAndroidCatalog.verify(swapped.getBytes(StandardCharsets.UTF_8),signed,pinnedPem,rootFingerprint,0,null,
      Collections.singletonList("payments.mftintelligence.com"),NOW);fail("tampering accepted");}
    catch(SecurityException expected){assertTrue(expected.getMessage().contains("signature"));}
  }
  @Test public void rogueRootPinFails()throws Exception{
    byte[] raw=baseline().toString().getBytes(StandardCharsets.UTF_8);
    try{V2SignedAndroidCatalog.verify(raw,sig(raw),pinnedPem,repeat('f',64),0,null,
      Collections.singletonList("payments.mftintelligence.com"),NOW);fail("untrusted root accepted");}
    catch(SecurityException expected){assertTrue(expected.getMessage().contains("root"));}
  }
  @Test public void duplicateApplicationPackageOwnerIsRejected()throws Exception{
    JSONObject j=baseline();
    j.getJSONArray("publishers").getJSONObject(1).getJSONArray("grants").put(grant("android","com.musitu.chemistry",CERT_B));
    try{accept(j);fail("duplicate owner accepted");}catch(SecurityException expected){}
  }
  @Test public void unauthorizedPublisherTakeoverFails()throws Exception{
    JSONObject j=baseline();j.getJSONArray("apps").getJSONObject(0).put("publisherId","northstar");
    try{accept(j);fail("takeover accepted");}catch(SecurityException expected){}
  }
  @Test public void unauthorizedSignerChangeFails()throws Exception{
    JSONObject j=baseline();j.getJSONArray("apps").getJSONObject(0).getJSONArray("releases").getJSONObject(0)
      .put("signingCertificateSha256",CERT_B);
    try{accept(j);fail("signer substitution accepted");}catch(SecurityException expected){}
  }
  @Test public void untrustedOrInsecureArtifactHostsFail()throws Exception{
    JSONObject j=baseline(),r=j.getJSONArray("apps").getJSONObject(0).getJSONArray("releases").getJSONObject(0);
    r.put("artifactURL","https://evil.example/chemistry.apk");
    try{accept(j);fail("untrusted host");}catch(SecurityException expected){}
    r.put("artifactURL","http://payments.mftintelligence.com/chemistry.apk");
    try{accept(j);fail("HTTP host");}catch(SecurityException expected){}
  }
  @Test public void expiredCatalogIsRejected()throws Exception{
    JSONObject j=baseline().put("expiresAt","2026-10-11T00:00:00.000Z");
    try{accept(j);fail("expired catalog accepted");}catch(SecurityException expected){}
  }
  @Test public void revisionAndDigestWatermarkRejectsReplayAndEquivocation()throws Exception{
    JSONObject j=baseline();
    try{accept(j,2,SHA_A);fail("rollback accepted");}catch(SecurityException expected){}
    try{accept(j,1,SHA_A);fail("same revision different digest accepted");}catch(SecurityException expected){}
    V2SignedAndroidCatalog.Verified v=accept(j);
    assertEquals(v.digest,accept(j,1,v.digest).digest);
  }
  @Test public void malformedNativePackageIsRejected()throws Exception{
    JSONObject j=baseline();j.getJSONArray("apps").getJSONObject(0).getJSONArray("releases")
      .getJSONObject(0).put("packageId","not-an-android.package!");
    try{accept(j);fail("invalid native package accepted");}catch(SecurityException expected){}
  }
  @Test public void catalogCannotClaimAnUnboundedDownload()throws Exception{
    JSONObject j=baseline();j.getJSONArray("apps").getJSONObject(0).getJSONArray("releases")
      .getJSONObject(0).put("bytes",9000000000L);
    try{accept(j);fail("oversized package accepted");}catch(SecurityException expected){}
  }
}
