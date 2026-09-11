package com.musitu.store;

public final class NativeInstallPolicyContract {
  interface Checked { void run() throws Exception; }

  static void rejects(Checked action)throws Exception{
    try{action.run();throw new AssertionError("untrusted package metadata was accepted");}
    catch(SecurityException expected){}
  }

  public static void main(String[] args)throws Exception{
    String sha="4ba442122d9c86a0c3cef660334fe337c6ea9ae6fe853c964b5e94961245babd";
    NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com/chemistry/download/MUSITU_Chemistry.apk",5892286,sha);
    NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com:443/store/android/repo/MUSITU_Chemistry.apk",5892286,sha);
    rejects(()->NativeInstallPolicy.requireTrustedApk("http://payments.mftintelligence.com/chemistry/download/app.apk",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://evil.example/chemistry/download/app.apk",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com.evil.example/chemistry/download/app.apk",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://user@payments.mftintelligence.com/chemistry/download/app.apk",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com:444/chemistry/download/app.apk",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com/untrusted/app.apk",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com/chemistry/download/app.apk#other",1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com/chemistry/download/app.apk",0,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com/chemistry/download/app.apk",NativeInstallPolicy.MAX_APK_BYTES+1,sha));
    rejects(()->NativeInstallPolicy.requireTrustedApk("https://payments.mftintelligence.com/chemistry/download/app.apk",1,"not-a-sha"));
    System.out.println("STORE_NATIVE_INSTALL_POLICY=PASS");
  }
}
