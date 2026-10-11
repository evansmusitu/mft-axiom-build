package com.musitu.store;

import org.json.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * EXPERIMENTAL / NOT CONNECTED TO THE LIVE V1 STORE.
 *
 * Root-signed multi-publisher release selection for a future Android client.
 * Ownership grants MUST be signed by the pinned Store root; no publisher data
 * or request parameters may supply or override the root trust anchor.
 */
final class V2SignedAndroidCatalog {
  static final int MAX_CATALOG_BYTES=1024*1024, MAX_SIGNATURE_BYTES=16*1024;
  static final long MAX_DURATION_MS=30L*24*60*60*1000, CLOCK_SKEW_MS=60*1000;
  static final long MAX_APK_BYTES=512L*1024*1024;
  static final String P256_ORDER="ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551";
  static final String HEX="[0-9a-f]{64}";

  static final class Release {
    final String appId, publisherId, packageId, apkUrl, sha256, signingCertificateSha256;
    final long versionCode, bytes;
    private Release(String appId,String publisherId,String packageId,String apkUrl,String sha256,String certificate,long versionCode,long bytes){
      this.appId=appId;this.publisherId=publisherId;this.packageId=packageId;this.apkUrl=apkUrl;
      this.sha256=sha256;this.signingCertificateSha256=certificate;this.versionCode=versionCode;this.bytes=bytes;
    }
  }

  static final class Verified {
    final long revision;
    final String digest;
    final List<Release> androidReleases;
    private Verified(long revision,String digest,List<Release> releases){
      this.revision=revision;this.digest=digest;this.androidReleases=Collections.unmodifiableList(new ArrayList<>(releases));
    }
    Release selectAndroid(String appId) {
      for(Release r:androidReleases)if(r.appId.equals(appId))return r;
      throw new SecurityException("unknown or unsupported Android application");
    }
  }

  static String digest(byte[] raw) throws Exception {
    byte[] hash=MessageDigest.getInstance("SHA-256").digest(raw);
    StringBuilder b=new StringBuilder(64);
    for(byte x:hash)b.append(String.format(Locale.ROOT,"%02x",x&255));
    return b.toString();
  }
  static void require(boolean predicate,String message){if(!predicate)throw new SecurityException(message);}
  static void string(String value,String where,int max) {
    require(value!=null && value.length()>0 && value.length()<=max && value.equals(value.trim()),"invalid "+where);
  }
  static void hash(String value,String where){require(value!=null&&value.matches(HEX),"invalid "+where+" SHA-256");}
  static String value(JSONObject o,String key,int max)throws JSONException {
    Object raw=o.get(key);require(raw instanceof String,"invalid "+key+" type");
    String s=(String)raw;string(s,key,max);return s;
  }
  static long positive(JSONObject o,String key,long limit)throws JSONException {
    Object raw=o.get(key);
    require(raw instanceof Number,"invalid "+key+" numeric type");
    double n=((Number)raw).doubleValue();
    require(Double.isFinite(n)&&n>=1&&n<=limit&&Math.floor(n)==n,"invalid "+key);
    return ((Number)raw).longValue();
  }
  static String hashOf(JSONObject o,String key)throws JSONException{
    String s=value(o,key,64);hash(s,key);return s;
  }
  static JSONArray array(JSONObject o,String key,int max)throws JSONException{
    JSONArray a=o.getJSONArray(key);require(a.length()>0&&a.length()<=max,"invalid "+key+" collection");return a;
  }
  static long timestamp(JSONObject o,String key)throws Exception {
    String s=value(o,key,40);
    SimpleDateFormat df=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);
    df.setLenient(false);df.setTimeZone(TimeZone.getTimeZone("UTC"));
    ParsePosition p=new ParsePosition(0);Date d=df.parse(s,p);
    require(d!=null&&p.getIndex()==s.length()&&df.format(d).equals(s),"invalid "+key+" UTC timestamp");
    return d.getTime();
  }
  static void nativePackage(String packageId)throws Exception{
    string(packageId,"native packageId",255);
    require(packageId.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+"),"invalid Android packageId");
  }
  static void packageId(String platform,String id)throws Exception{
    string(id,"packageId",255);
    if("android".equals(platform)) nativePackage(id);
    else if("windows".equals(platform)) require(id.matches("[A-Za-z0-9][A-Za-z0-9._-]{1,127}"),"invalid Windows packageId");
    else if("web".equals(platform)){
      URI uri=URI.create(id);
      require("https".equals(uri.getScheme())&&uri.getHost()!=null&&uri.getUserInfo()==null&&
        uri.getRawQuery()==null&&uri.getRawFragment()==null&&uri.getPort()==-1,"invalid Web application identity");
    } else throw new SecurityException("unsupported platform");
  }
  static String signer(JSONObject o,String platform)throws JSONException {
    if("web".equals(platform)){
      require(!o.has("signingCertificateSha256"),"web identity must not claim a native signer");
      return null;
    }
    return hashOf(o,"signingCertificateSha256");
  }
  static void url(String u,String platform,Set<String> trustedHosts)throws Exception{
    string(u,"artifactURL",2048);
    URI parsed=new URI(u);
    require("https".equals(parsed.getScheme())&&parsed.getHost()!=null&&parsed.getUserInfo()==null&&
       parsed.getRawFragment()==null&&parsed.getRawQuery()==null&&parsed.getPort()==-1&&
       trustedHosts.contains(parsed.getHost()),"untrusted artifact URL host, parameters or protocol");
    String path=parsed.getRawPath();
    require(path!=null&&path.startsWith("/")&&!path.contains("%")&&!path.contains(".."),"unsafe artifact URL path");
    if("android".equals(platform))require(path.endsWith(".apk"),"Android artifact must be an APK");
  }

  static Verified verify(byte[] catalogBytes,byte[] signatureBytes,String rootPublicKeyPem,
       String expectedRootPemSha256,long highestAcceptedRevision,String highestAcceptedDigest,
       List<String> allowedArtifactHosts,long nowMillis) throws Exception {
    require(catalogBytes!=null&&catalogBytes.length>=2&&catalogBytes.length<=MAX_CATALOG_BYTES,"invalid catalog size");
    require(signatureBytes!=null&&signatureBytes.length>=8&&signatureBytes.length<=MAX_SIGNATURE_BYTES,"invalid signature size");
    require(rootPublicKeyPem!=null&&rootPublicKeyPem.length()>64&&rootPublicKeyPem.length()<=8192&&
      rootPublicKeyPem.contains("-----BEGIN PUBLIC KEY-----")&&rootPublicKeyPem.contains("-----END PUBLIC KEY-----"),
      "invalid pinned root PEM");
    hash(expectedRootPemSha256,"root pin");
    require(digest(rootPublicKeyPem.getBytes(StandardCharsets.UTF_8)).equals(expectedRootPemSha256),"root signer pin mismatch");
    require(highestAcceptedRevision>=0,"trusted revision watermark missing");
    if(highestAcceptedRevision>0)hash(highestAcceptedDigest,"trusted digest watermark");
    require(allowedArtifactHosts!=null&&allowedArtifactHosts.size()>0&&allowedArtifactHosts.size()<=100,"no trusted artifact hosts");
    require(nowMillis>0,"trusted current timestamp missing");

    String der=rootPublicKeyPem.replace("-----BEGIN PUBLIC KEY-----","")
      .replace("-----END PUBLIC KEY-----","").replaceAll("\\s","");
    PublicKey root=KeyFactory.getInstance("EC")
      .generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(der)));
    require(root instanceof ECPublicKey &&
      ((ECPublicKey)root).getParams().getOrder().toString(16).equalsIgnoreCase(P256_ORDER),"root key is not NIST P-256");
    Signature check=Signature.getInstance("SHA256withECDSA");
    check.initVerify(root);check.update(catalogBytes);
    require(check.verify(signatureBytes),"catalog signature invalid");

    String raw=new String(catalogBytes,StandardCharsets.UTF_8);
    require(Arrays.equals(raw.getBytes(StandardCharsets.UTF_8),catalogBytes),"catalog contains malformed UTF-8");
    JSONObject cat=new JSONObject(raw);
    require("musitu.store.catalog.v2".equals(value(cat,"schema",64)),"unsupported catalog schema");
    long revision=positive(cat,"revision",Long.MAX_VALUE);
    String d=digest(catalogBytes);
    require(revision>=highestAcceptedRevision,"catalog revision replay");
    require(revision!=highestAcceptedRevision||d.equals(highestAcceptedDigest),"revision digest equivocation or missing digest");
    long issued=timestamp(cat,"issuedAt"),expires=timestamp(cat,"expiresAt");
    require(issued<=nowMillis+CLOCK_SKEW_MS,"catalog issued in future");
    require(expires>nowMillis,"catalog expired");
    require(expires>issued&&expires-issued<=MAX_DURATION_MS,"invalid validity duration");

    Set<String> hosts=new HashSet<>();
    for(String host:allowedArtifactHosts){
      string(host,"trusted host",253);
      require(host.matches("[a-z0-9][a-z0-9.-]*[a-z0-9]"),"invalid trusted host");
      hosts.add(host);
    }
    Map<String,String> owners=new HashMap<>();
    Map<String,String> certificates=new HashMap<>();
    Set<String> publishers=new HashSet<>();
    JSONArray ps=array(cat,"publishers",1000);
    for(int i=0;i<ps.length();i++){
      JSONObject p=ps.getJSONObject(i);
      String pub=value(p,"id",64),name=value(p,"name",128);
      require(pub.matches("[a-z][a-z0-9-]{2,63}")&&publishers.add(pub),"duplicate or invalid publisher");
      JSONArray grants=array(p,"grants",1000);
      for(int g=0;g<grants.length();g++){
        JSONObject grant=grants.getJSONObject(g);
        String platform=value(grant,"platform",32),pkg=value(grant,"packageId",255);
        packageId(platform,pkg);
        String cert=signer(grant,platform);
        String grantId=platform+":"+pkg;
        require(!owners.containsKey(grantId),"duplicate package ownership");
        owners.put(grantId,pub);
        certificates.put(grantId,cert);
      }
    }

    Set<String> apps=new HashSet<>(),taken=new HashSet<>();
    List<Release> android=new ArrayList<>();
    JSONArray as=array(cat,"apps",1000);
    for(int i=0;i<as.length();i++){
      JSONObject app=as.getJSONObject(i);
      String appId=value(app,"id",64),publisher=value(app,"publisherId",64);
      require(appId.matches("[a-z][a-z0-9-]{2,63}")&&apps.add(appId),"duplicate or invalid app identity");
      require(publishers.contains(publisher),"unknown publisher");
      Set<String> revisions=new HashSet<>();
      JSONArray releases=array(app,"releases",1000);
      for(int j=0;j<releases.length();j++){
        JSONObject release=releases.getJSONObject(j);
        String platform=value(release,"platform",32),pkg=value(release,"packageId",255);
        packageId(platform,pkg);
        String releaseSigner=signer(release,platform),key=platform+":"+pkg;
        require(publisher.equals(owners.get(key)),"publisher not authorized for package identity");
        require(Objects.equals(releaseSigner,certificates.get(key)),"unauthorized release signer");
        String version=value(release,"version",64);
        require(version.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?"),"invalid release version");
        long versionCode=positive(release,"versionCode",Long.MAX_VALUE);
        require(revisions.add(key+":"+versionCode),"duplicate release versionCode");
        String artifact=value(release,"artifactURL",2048);
        url(artifact,platform,hosts);
        String releaseHash=hashOf(release,"sha256");
        long bytes=positive(release,"bytes",Long.MAX_VALUE);
        require(!"android".equals(platform)||bytes<=MAX_APK_BYTES,"APK size exceeds safety limit");
        if("android".equals(platform)){
          require(taken.add(key),"multiple Android release entries require explicit channel selection");
          android.add(new Release(appId,publisher,pkg,artifact,releaseHash,releaseSigner,versionCode,bytes));
        }
      }
    }
    return new Verified(revision,d,android);
  }
  private V2SignedAndroidCatalog(){}
}
