package com.musitu.store;
import java.io.*;
final class V2AndroidNativeInstallPolicy {
  static final class ArchiveInfo {
    final String packageId,certSha256;
    final long versionCode;
    ArchiveInfo(String packageId,String certSha256,long versionCode){
      this.packageId=packageId;this.certSha256=certSha256;this.versionCode=versionCode;
    }
  }
  static File stage(InputStream bytes,File filesDir,V2SignedAndroidCatalog.Release release)throws Exception{
    throw new UnsupportedOperationException("not implemented");
  }
  static void verifyCandidate(File filesDir,File apk,V2SignedAndroidCatalog.Release release,ArchiveInfo archive,long installedVersion)throws Exception{
    throw new UnsupportedOperationException("not implemented");
  }
}
