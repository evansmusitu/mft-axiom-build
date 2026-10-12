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
    return new Card("Not installed","Install",true); // RED placeholder.
  }
  static Card inspectionFailed() {
    return new Card("Not installed","Install",true); // RED placeholder.
  }
  private V2AndroidInstallPresentation(){}
}
