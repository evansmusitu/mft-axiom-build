package com.musitu.store;

import org.junit.Test;
import org.junit.BeforeClass;
import java.util.List;
import static org.junit.Assert.*;

public final class V2AndroidAppListingTest {
  @BeforeClass public static void initializeKey()throws Exception{
    V2SignedAndroidCatalogTest.key();
  }
  @Test public void listsTwoIndependentPublishersFromValidatedCatalog()throws Exception{
    V2SignedAndroidCatalog.Verified catalog=V2SignedAndroidCatalogTest.accept(V2SignedAndroidCatalogTest.baseline());
    List<V2AndroidAppListing.Entry> entries=V2AndroidAppListing.from(catalog);
    assertEquals(2,entries.size());
    assertEquals("musitu-chemistry",entries.get(0).appId);
    assertEquals("musitu",entries.get(0).publisherId);
    assertEquals("com.musitu.chemistry",entries.get(0).packageId);
    assertEquals("northstar-app",entries.get(1).appId);
    assertEquals("northstar",entries.get(1).publisherId);
    assertEquals("org.northstar.app",entries.get(1).packageId);
  }
  @Test public void selectionsStayBoundToAuthorizedCatalogIdentity()throws Exception{
    V2SignedAndroidCatalog.Verified catalog=V2SignedAndroidCatalogTest.accept(V2SignedAndroidCatalogTest.baseline());
    assertEquals("com.musitu.chemistry",V2AndroidAppListing.select(catalog,"musitu-chemistry").packageId);
    assertEquals("org.northstar.app",V2AndroidAppListing.select(catalog,"northstar-app").packageId);
    try{V2AndroidAppListing.select(catalog,"com.attacker.pkg");fail("unknown app accepted");}
    catch(SecurityException expected){}
  }
  @Test public void aMissingVerifiedRegistryCannotBuildTrustedMarketplace()throws Exception{
    try{V2AndroidAppListing.from(null);fail("null registry accepted");}
    catch(SecurityException expected){}
    try{V2AndroidAppListing.select(null,"musitu-chemistry");fail("null registry accepted");}
    catch(SecurityException expected){}
  }
  @Test public void listCannotBeModifiedToInsertUnsignedEntries()throws Exception{
    V2SignedAndroidCatalog.Verified catalog=V2SignedAndroidCatalogTest.accept(V2SignedAndroidCatalogTest.baseline());
    List<V2AndroidAppListing.Entry> entries=V2AndroidAppListing.from(catalog);
    try{entries.clear();fail("untrusted mutation accepted");}
    catch(UnsupportedOperationException expected){}
    assertEquals(2,V2AndroidAppListing.from(catalog).size());
  }
}
