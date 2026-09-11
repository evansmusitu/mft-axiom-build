package com.musitu.store;

import java.net.URI;

final class NativeInstallPolicy {
  static final String DOWNLOAD_HOST="payments.mftintelligence.com";
  static final long MAX_APK_BYTES=512L*1024*1024;

  static void requireTrustedApk(String url,long expectedBytes,String expectedSha)throws Exception{
    requireExpectedArtifact(expectedBytes,expectedSha);
    URI u=new URI(url);String path=u.getRawPath();
    if(!"https".equalsIgnoreCase(u.getScheme())||!DOWNLOAD_HOST.equalsIgnoreCase(u.getHost())||u.getUserInfo()!=null||u.getFragment()!=null||(u.getPort()!=-1&&u.getPort()!=443)||path==null||!(path.startsWith("/chemistry/download/")||path.startsWith("/store/android/repo/")))throw new SecurityException("untrusted APK URL");
  }

  static void requireExpectedArtifact(long expectedBytes,String expectedSha){
    if(expectedBytes<=0||expectedBytes>MAX_APK_BYTES)throw new SecurityException("invalid APK size");
    if(expectedSha==null||!expectedSha.matches("(?i)[0-9a-f]{64}"))throw new SecurityException("invalid APK SHA-256");
  }

  private NativeInstallPolicy(){}
}
