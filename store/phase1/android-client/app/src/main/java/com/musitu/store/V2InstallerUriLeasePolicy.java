package com.musitu.store;

import java.io.File;
import java.io.IOException;

/** Pure-Java fail-closed path and deadline policy for V2's scoped read grant. */
final class V2InstallerUriLeasePolicy {
  static final long MAX_LEASE_MS=60L*60*1000;
  static File checkedLeasePath(File privateFiles,File candidate)throws IOException {
    if(privateFiles==null||candidate==null)throw new SecurityException("missing private APK lease path");
    File base=new File(privateFiles,"downloads/v2").getCanonicalFile();
    File apk=candidate.getCanonicalFile();
    if(!apk.getParentFile().equals(base)||
       !apk.getName().matches("[a-f0-9]{64}\\.apk"))
      throw new SecurityException("lease only a staged, SHA-256-named APK");
    return apk;
  }
  static File checkedApk(File privateFiles,File candidate)throws IOException {
    File apk=checkedLeasePath(privateFiles,candidate);
    if(!apk.isFile())throw new SecurityException("verified staged APK missing");
    return apk;
  }
  static long expirationAtElapsedRealtime(long now){
    if(now<0||now>Long.MAX_VALUE-MAX_LEASE_MS)
      throw new IllegalArgumentException("invalid monotonic clock for expiry");
    return now+MAX_LEASE_MS;
  }
  private V2InstallerUriLeasePolicy(){}
}
