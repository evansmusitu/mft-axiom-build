package com.musitu.store;

import java.io.File;
import java.nio.file.Files;

/** Pure Java safety contract for the installer-grant expiry receiver. */
public final class V2InstallerUriLeaseContract {
  private static void expectReject(File root,File bad)throws Exception{
    try{V2InstallerUriLeasePolicy.checkedApk(root,bad);throw new AssertionError("unsafe URI lease accepted: "+bad);}
    catch(SecurityException expected){}
  }
  public static void main(String[] ignored)throws Exception{
    File files=Files.createTempDirectory("v2-lease-contract").toFile();
    File downloads=new File(files,"downloads/v2");
    if(!downloads.mkdirs())throw new AssertionError("failed to create staging directory");
    String sha="0123456789abcdef".repeat(4);
    File good=new File(downloads,sha+".apk");
    if(!good.createNewFile())throw new AssertionError("failed to create fixture");
    if(!V2InstallerUriLeasePolicy.checkedApk(files,good).equals(good.getCanonicalFile()))
      throw new AssertionError("valid staged APK rejected");
    expectReject(files,new File(downloads,"../"+sha+".apk"));
    File outside=File.createTempFile("out-of-store-",".apk");
    expectReject(files,outside);
    File unsigned=new File(downloads,"unverified.apk");
    unsigned.createNewFile();
    // A cleanup alarm must still be able to revoke a grant after the APK
    // has been deleted from disk by Android or the Store.
    File deleted=new File(downloads,"abcdef0123456789".repeat(4)+".apk");
    if(!V2InstallerUriLeasePolicy.checkedLeasePath(files,deleted).equals(deleted.getCanonicalFile()))
      throw new AssertionError("deleted APK blocked URI grant cleanup");
    expectReject(files,unsigned);
    expectReject(files,new File(downloads,sha+".apk.nonexistent"));
    long now=65_000;
    long expected=now+60L*60*1000;
    if(V2InstallerUriLeasePolicy.expirationAtElapsedRealtime(now)!=expected)
      throw new AssertionError("grant lifetime not bounded to one hour");
    try{V2InstallerUriLeasePolicy.expirationAtElapsedRealtime(Long.MAX_VALUE);throw new AssertionError("expiry overflow accepted");}
    catch(IllegalArgumentException expectedFailure){}
    System.out.println("MUSITU_STORE_V2_INSTALLER_GRANT_LEASE_CONTRACT_PASS assertions=8");
  }
}
