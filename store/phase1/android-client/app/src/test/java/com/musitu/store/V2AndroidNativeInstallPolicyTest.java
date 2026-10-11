package com.musitu.store;

import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import static org.junit.Assert.*;

public final class V2AndroidNativeInstallPolicyTest {
  private static final String CERT="b".repeat(64);
  static final byte[] PAYLOAD="A signed app-shaped test fixture (not an APK)".getBytes(StandardCharsets.UTF_8);
  @BeforeClass public static void setupKey()throws Exception{V2SignedAndroidCatalogTest.key();}
  static String hex(byte[] bytes)throws Exception{
    byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder b=new StringBuilder();
    for(byte h:hash)b.append(String.format("%02x",h&255));return b.toString();
  }
  static V2SignedAndroidCatalog.Release release(byte[] payload)throws Exception{
    JSONObject cat=V2SignedAndroidCatalogTest.baseline();
    JSONObject a=cat.getJSONArray("apps").getJSONObject(0).getJSONArray("releases").getJSONObject(0);
    a.put("sha256",hex(payload)).put("bytes",payload.length);
    return V2SignedAndroidCatalogTest.accept(cat).selectAndroid("musitu-chemistry");
  }
  static File storeRoot()throws Exception{return Files.createTempDirectory("musitu-v2-policy").toFile();}
  static V2AndroidNativeInstallPolicy.ArchiveInfo correct(V2SignedAndroidCatalog.Release r){
    return new V2AndroidNativeInstallPolicy.ArchiveInfo(r.packageId,r.signingCertificateSha256,r.versionCode);
  }
  @Test public void stagesAndVerifiesAnAuthorizedArtifactUnderPrivateStoreFiles()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    assertTrue(apk.isFile());
    assertTrue(apk.getCanonicalPath().startsWith(new File(root,"downloads/v2").getCanonicalPath()+File.separator));
    assertEquals(PAYLOAD.length,apk.length());
    V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,correct(r),-1);
  }
  @Test public void wrongSignatureCertificateIsRejected()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,new V2AndroidNativeInstallPolicy.ArchiveInfo(r.packageId,"c".repeat(64),r.versionCode),-1);fail("signer accepted");}
    catch(SecurityException expected){}
  }
  @Test public void wrongPackageIdentityIsRejected()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,new V2AndroidNativeInstallPolicy.ArchiveInfo("org.evil.app",r.signingCertificateSha256,r.versionCode),-1);fail("takeover accepted");}
    catch(SecurityException expected){}
  }
  @Test public void wrongAPKVersionCodeIsRejected()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,new V2AndroidNativeInstallPolicy.ArchiveInfo(r.packageId,r.signingCertificateSha256,r.versionCode+1),-1);fail("wrong version accepted");}
    catch(SecurityException expected){}
  }
  @Test public void unauthorizedDowngradeIsRejected()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,correct(r),r.versionCode+1);fail("downgrade accepted");}
    catch(SecurityException expected){}
  }
  @Test public void incompleteTransferDoesNotPromoteAPK()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    try{V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(Arrays.copyOf(PAYLOAD,PAYLOAD.length-1)),root,r);fail("incomplete accepted");}
    catch(SecurityException expected){}
    assertFalse(new File(root,"downloads/v2/"+r.sha256+".apk").exists());
  }
  @Test public void wrongHashDoesNotPromoteAPK()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    byte[] bad=Arrays.copyOf(PAYLOAD,PAYLOAD.length);bad[1]^=1;
    try{V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(bad),root,r);fail("tamper accepted");}
    catch(SecurityException expected){}
    assertFalse(new File(root,"downloads/v2/"+r.sha256+".apk").exists());
  }
  @Test public void oversizedResponseDoesNotPromoteAPK()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    try{V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(Arrays.copyOf(PAYLOAD,PAYLOAD.length+1)),root,r);fail("overflow accepted");}
    catch(SecurityException expected){}
    assertFalse(new File(root,"downloads/v2/"+r.sha256+".apk").exists());
  }
  @Test public void pathOutsidePrivateStoreDirectoryIsRejected()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File other=File.createTempFile("outside","apk");
    Files.write(other.toPath(),PAYLOAD);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,other,r,correct(r),-1);fail("external path accepted");}
    catch(SecurityException expected){}
  }
  @Test public void modifiedOnDiskAPKIsRejectedEvenIfArchiveMetadataIsCorrect()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    byte[] tampered=Arrays.copyOf(PAYLOAD,PAYLOAD.length);tampered[0]^=1;
    Files.write(apk.toPath(),tampered);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,correct(r),-1);fail("altered APK accepted");}
    catch(SecurityException expected){}
  }
  @Test public void stagedArtifactCannotBeInsecurelyPromotedWithoutArchiveProbe()throws Exception{
    File root=storeRoot();V2SignedAndroidCatalog.Release r=release(PAYLOAD);
    File apk=V2AndroidNativeInstallPolicy.stage(new ByteArrayInputStream(PAYLOAD),root,r);
    try{V2AndroidNativeInstallPolicy.verifyCandidate(root,apk,r,null,-1);fail("missing APK inspection accepted");}
    catch(SecurityException expected){}
  }
}
