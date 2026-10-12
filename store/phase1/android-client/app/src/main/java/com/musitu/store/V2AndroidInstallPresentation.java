package com.musitu.store;

/** Non-production V2 card labels from independently observed Android package state. */
final class V2AndroidInstallPresentation {
  static final class Card {
    final String status, action;
    final boolean reviewEnabled;
    Card(String status,String action,boolean reviewEnabled) {
      this.status=status;this.action=action;this.reviewEnabled=reviewEnabled;
    }
  }
  static Card forState(V2AndroidInstalledPackageState.State state) {
    if(state==null)throw new SecurityException("unverified installed-package state");
    switch(state){
      case UNKNOWN_VISIBILITY:
        return new Card("Install status unavailable — Android may hide this app",
                        "Review installation with Android",true);
      case VERIFIED_INSTALLED:
        return new Card("Verified installed — Android signer and version checked",
                        "Review update or reinstall",true);
      case REJECTED_PACKAGE_IDENTITY:
        return new Card("Blocked — installed package identity conflicts with signed catalog",
                        "Blocked by security check",false);
      case REJECTED_SIGNER:
        return new Card("Blocked — installed signer conflicts with signed catalog",
                        "Blocked by security check",false);
      case REJECTED_DOWNGRADE:
        return new Card("Blocked — newer installed version would be downgraded",
                        "Blocked by security check",false);
      default:throw new SecurityException("unsupported installed-package state");
    }
  }
  static Card inspectionFailed() {
    return new Card("Could not verify Android installed-package status",
                    "Blocked pending verification",false);
  }
  private V2AndroidInstallPresentation(){}
}
