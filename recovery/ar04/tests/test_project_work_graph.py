import tempfile, unittest
from pathlib import Path
from recovery.ar04.project_work_graph import ProjectWorkGraph,TenantIsolationError


class ProjectWorkGraphTests(unittest.TestCase):
    def test_two_device_sync_all_objects_and_provenance(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar04-") as td:
            g=ProjectWorkGraph(Path(td)/"graph.sqlite3"); tenant="tenant-a"; project="project-a"
            ids=[]
            for typ in ("project","work","artifact","agent","memory","source","approval"):
                ids.append(g.create(tenant,project,typ,{"kind":typ,"value":1}))
            dev_a=g.sync(tenant,project,0); dev_b=g.sync(tenant,project,0)
            self.assertEqual(dev_a["cursor"],dev_b["cursor"])
            self.assertEqual(len(dev_a["events"]),7)
            self.assertTrue(g.verify_provenance(tenant,project))
            g.update(tenant,ids[1],{"kind":"work","value":2},1)
            a2=g.sync(tenant,project,dev_a["cursor"]); b2=g.sync(tenant,project,dev_b["cursor"])
            self.assertEqual(a2["events"],b2["events"])
            self.assertEqual(a2["cursor"],b2["cursor"])
            self.assertTrue(g.verify_provenance(tenant,project))
            g.close()

    def test_cross_tenant_and_import_reconciliation_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar04-") as td:
            g=ProjectWorkGraph(Path(td)/"graph.sqlite3")
            obj=g.create("tenant-a","project-a","artifact",{"name":"a"})
            with self.assertRaises(TenantIsolationError):
                g.get("tenant-b",obj)
            rows=[{"id":"local-1","project_id":"project-a","object_type":"memory","payload":{"fact":"x"}}]
            first=g.import_local("tenant-a","browser-indexeddb",rows)
            second=g.import_local("tenant-a","browser-indexeddb",rows)
            self.assertEqual(first,second)
            self.assertTrue(g.verify_provenance("tenant-a","project-a"))
            g.close()


if __name__=="__main__":
    unittest.main()
