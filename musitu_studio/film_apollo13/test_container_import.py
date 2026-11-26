"""Regression: /root/film_modal.py has no second parent above its directory."""
import ast,pathlib,unittest
from unittest.mock import Mock
class ContainerImportTest(unittest.TestCase):
    def test_remote_and_local_image_declaration(self):
        source=pathlib.Path(__file__).with_name('film_modal.py').read_text()
        tree=ast.parse(source)
        # Execute real module initialization through the first function declaration,
        # with only Modal network/image-building primitives mocked.
        prefix=[]
        for node in tree.body:
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):break
            if isinstance(node,ast.Import):
                node.names=[x for x in node.names if x.name!='modal']
                if not node.names:continue
            prefix.append(node)
        code=compile(ast.Module(body=prefix,type_ignores=[]),'film_modal.py','exec')
        for local,location in [(False,'/root/film_modal.py'),(True,'/checkout/musitu_studio/film_apollo13/film_modal.py')]:
            m=Mock();m.is_local.return_value=local
            ns={'modal':m,'__file__':location}
            exec(code,ns)
            calls=str(m.mock_calls)
            self.assertEqual('build_awaken_2099.py' in calls,local)
if __name__=='__main__':unittest.main()
