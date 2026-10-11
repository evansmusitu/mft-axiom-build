package com.musitu.store;

import java.io.*;
import java.security.MessageDigest;

/**
 * Isolated, platform-neutral stage-and-verify component for signed V2 releases.
 *
 * This class MUST only receive a release returned by V2SignedAndroidCatalog.Verified;
 * it neither trusts publisher-supplied metadata nor grants installation rights.
 * Actual native APK signer/package/version are independently inspected by Android.
 */
final class V2AndroidNativeInstallPolicy {
  static final class ArchiveInfo {
    final String packageId,certSha256;
    final long versionCode;
    ArchiveInfo(String packageId,String certSha256,long versionCode){
      this.packageId=packageId;this.certSha256=certSha256;this.versionCode=versionCode;
    }
  }

  private static File downloadDir(File filesDir)throws Exception{
    if(filesDir==null)throw new SecurityException("missing private Store directory");
    File dir=new File(filesDir.getCanonicalFile(),"downloads/v2");
    if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("cannot create private verified downloads");
    return dir.getCanonicalFile();
  }
  private static void requireRelease(V2SignedAndroidCatalog.Release release) {
    if(release==null||release.bytes<=0||release.bytes>V2SignedAndroidCatalog.MAX_APK_BYTES||
        release.sha256==null||!release.sha256.matches("[0-9a-f]{64}"))
      throw new SecurityException("invalid signed Android release");
  }
  private static String hex(byte[] raw){
    StringBuilder b=new StringBuilder(raw.length*2);
    for(byte c:raw)b.append(String.format("%02x",c&255));
    return b.toString();
  }
  static File stage(InputStream bytes,File filesDir,V2SignedAndroidCatalog.Release release)throws Exception {
    requireRelease(release);
    if(bytes==null)throw new SecurityException("missing download stream");
    File dir=downloadDir(filesDir);
    File temp=File.createTempFile("v2_",".apk.part",dir);
    File output=new File(dir,release.sha256+".apk");
    boolean promoted=false;
    try{
      MessageDigest sha=MessageDigest.getInstance("SHA-256");
      long total=0;
      try(InputStream input=bytes; FileOutputStream dest=new FileOutputStream(temp)){
        byte[] buffer=new byte[65536];
        for(int n;(n=input.read(buffer))!=-1;){
          if(n==0)continue;
          total+=n;
          if(total>release.bytes)throw new SecurityException("download exceeds signed artifact length");
          dest.write(buffer,0,n);sha.update(buffer,0,n);
        }
        dest.getFD().sync();
      }
      if(total!=release.bytes)throw new SecurityException("incomplete signed APK download");
      if(!hex(sha.digest()).equals(release.sha256))throw new SecurityException("APK SHA-256 mismatch");
      if(output.exists()&&!output.delete())throw new IOException("cannot replace verified candidate");
      if(!temp.renameTo(output))throw new IOException("cannot promote verified candidate");
      promoted=true;
      return output.getCanonicalFile();
    }finally{
      if(!promoted)temp.delete();
    }
  }

  static void verifyCandidate(File filesDir,File apk,V2SignedAndroidCatalog.Release release,
                              ArchiveInfo archive,long installedVersion)throws Exception{
    requireRelease(release);
    if(archive==null||apk==null)throw new SecurityException("APK package identity/signing inspection required");
    File dir=downloadDir(filesDir);
    File actual=apk.getCanonicalFile();
    if(!actual.getPath().startsWith(dir.getPath()+File.separator))
      throw new SecurityException("APK must remain in private Store downloads");
    if(!actual.getName().equals(release.sha256+".apk"))
      throw new SecurityException("unexpected verified APK name");
    if(!actual.isFile()||actual.length()!=release.bytes)
      throw new SecurityException("APK length differs from signed release");
    try(FileInputStream in=new FileInputStream(actual)){
      MessageDigest digest=MessageDigest.getInstance("SHA-256");
      byte[] b=new byte[65536];for(int n;(n=in.read(b))!=-1;)if(n>0)digest.update(b,0,n);
      if(!hex(digest.digest()).equals(release.sha256))throw new SecurityException("APK SHA-256 mismatch");
    }
    if(!release.packageId.equals(archive.packageId))throw new SecurityException("APK package identity mismatch");
    if(!release.signingCertificateSha256.equals(archive.certSha256))
      throw new SecurityException("APK signing certificate mismatch");
    if(archive.versionCode!=release.versionCode)throw new SecurityException("APK versionCode differs from signed release");
    if(installedVersion>=0 && release.versionCode<installedVersion)
      throw new SecurityException("unauthorized downgrade is blocked");
  }
  private V2AndroidNativeInstallPolicy(){}
}
