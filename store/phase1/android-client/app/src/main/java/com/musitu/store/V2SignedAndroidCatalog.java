package com.musitu.store;

import java.util.List;

/** Isolated Android v2 catalog candidate. No production client uses this type. */
final class V2SignedAndroidCatalog {
  static final class Release {
    final String appId, publisherId, packageId, apkUrl, sha256, signingCertificateSha256;
    final long versionCode, bytes;
    Release(String appId,String publisherId,String packageId,String apkUrl,String sha256,String certificate,long versionCode,long bytes){
      this.appId=appId;this.publisherId=publisherId;this.packageId=packageId;this.apkUrl=apkUrl;
      this.sha256=sha256;this.signingCertificateSha256=certificate;this.versionCode=versionCode;this.bytes=bytes;
    }
  }
  static final class Verified {
    final long revision;
    final String digest;
    final List<Release> androidReleases;
    Verified(long revision,String digest,List<Release> releases){
      this.revision=revision;this.digest=digest;this.androidReleases=releases;
    }
    Release selectAndroid(String appId) {throw new UnsupportedOperationException("not implemented");}
  }
  static Verified verify(byte[] catalogBytes,byte[] signatureBytes,String rootPublicKeyPem,
       String expectedRootPemSha256,long highestAcceptedRevision,String highestAcceptedDigest,
       List<String> allowedArtifactHosts,long nowMillis) throws Exception {
    throw new UnsupportedOperationException("not implemented");
  }
}
