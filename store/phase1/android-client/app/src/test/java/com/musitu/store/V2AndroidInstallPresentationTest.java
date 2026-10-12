package com.musitu.store;

import org.junit.Test;
import static org.junit.Assert.*;

public final class V2AndroidInstallPresentationTest {
  private static V2AndroidInstallPresentation.Card card(V2AndroidInstalledPackageState.State state) {
    return V2AndroidInstallPresentation.forState(state);
  }
  @Test public void unknownVisibilityNeverClaimsApplicationNotInstalled() {
    V2AndroidInstallPresentation.Card c=card(V2AndroidInstalledPackageState.State.UNKNOWN_VISIBILITY);
    assertTrue("must explain Android's privacy filter",c.status.contains("unavailable"));
    assertTrue(c.status.contains("Android"));
    assertFalse(c.status.toLowerCase().contains("not installed"));
    assertTrue("normal OS consent pathway stays available",c.reviewEnabled);
    assertTrue(c.action.contains("Review"));
  }
  @Test public void onlyVerifiedStateClaimsAnApplicationIsInstalled() {
    V2AndroidInstallPresentation.Card c=card(V2AndroidInstalledPackageState.State.VERIFIED_INSTALLED);
    assertTrue(c.status.contains("Verified installed"));
    assertTrue(c.status.contains("signer"));
    assertTrue(c.reviewEnabled);
    assertTrue(c.action.contains("Review"));
  }
  @Test public void installedPackageWithWrongSignerCannotOfferInstallation() {
    V2AndroidInstallPresentation.Card c=card(V2AndroidInstalledPackageState.State.REJECTED_SIGNER);
    assertFalse(c.reviewEnabled);
    assertTrue(c.status.contains("signer"));
    assertTrue(c.action.contains("Blocked"));
  }
  @Test public void wrongPackageIdentityCannotOfferInstallation() {
    V2AndroidInstallPresentation.Card c=card(V2AndroidInstalledPackageState.State.REJECTED_PACKAGE_IDENTITY);
    assertFalse(c.reviewEnabled);
    assertTrue(c.status.contains("identity"));
  }
  @Test public void downgradeCandidateCannotOfferInstallation() {
    V2AndroidInstallPresentation.Card c=card(V2AndroidInstalledPackageState.State.REJECTED_DOWNGRADE);
    assertFalse(c.reviewEnabled);
    assertTrue(c.status.toLowerCase().contains("newer"));
  }
  @Test public void packageInspectionFailureCannotSilentlyBecomeNotInstalled() {
    V2AndroidInstallPresentation.Card c=V2AndroidInstallPresentation.inspectionFailed();
    assertFalse(c.reviewEnabled);
    assertTrue(c.status.toLowerCase().contains("could not verify"));
    assertFalse(c.status.toLowerCase().contains("not installed"));
  }
  @Test public void unknownPresentationInputMustFailClosed() {
    try{card(null);fail("missing package state accepted");}
    catch(SecurityException expected){}
  }
}
